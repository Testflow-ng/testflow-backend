import { LiveExam } from '../models/LiveExam.js';
import { LiveParticipant } from '../models/LiveParticipant.js';
import { Question } from '../models/Question.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { generateShareCode } from '../utils/liveCode.js';
import { computeScore, rankParticipants } from '../utils/liveRank.js';
import { shuffle } from '../utils/shuffle.js';
import { config } from '../config/env.js';
import { publish } from './liveEvents.js';
import { hasEntitlement } from './studentPlan.service.js';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const SHARE_CODE = /^[A-Za-z2-9]{6,16}$/;

const shareUrlFor = (shareCode) => `${config.CLIENT_URL.replace(/\/$/, '')}/live-cbt/${shareCode}`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadExamByCode = async (shareCode) => {
  // Codes are issued uppercase (the join form uppercases what participants
  // type). The case-insensitive fallback keeps rooms created before that rule
  // reachable.
  const normalized = String(shareCode).trim().toUpperCase();
  const exam =
    (await LiveExam.findOne({ shareCode: normalized })) ??
    (await LiveExam.findOne({ shareCode: { $regex: `^${escapeRegExp(normalized)}$`, $options: 'i' } }));
  if (!exam) throw new AppError(404, 'LIVE_EXAM_NOT_FOUND', 'Examination not found.');
  return exam;
};

const requireHost = (exam, userId) => {
  if (String(exam.host) !== String(userId)) {
    throw new AppError(403, 'NOT_EXAM_HOST', 'Only the host can perform this action.');
  }
};

const isTerminal = (exam) => ['completed', 'results_published', 'cancelled'].includes(exam.status);

/** Public/room-safe exam projection — never includes question content or answer keys. */
export const toRoomView = (exam, counts = {}) => ({
  id: String(exam._id),
  shareCode: exam.shareCode,
  shareUrl: shareUrlFor(exam.shareCode),
  title: exam.title,
  description: exam.description,
  status: exam.status,
  durationMinutes: exam.durationMinutes,
  maxParticipants: exam.maxParticipants ?? null,
  numQuestions: exam.numQuestions,
  difficulty: exam.difficulty,
  negativeMarking: exam.negativeMarking,
  marksPerQuestion: exam.marksPerQuestion,
  allowReview: exam.allowReview,
  startedAt: exam.startedAt ?? null,
  endsAt: exam.endsAt ?? null,
  serverTime: new Date().toISOString(),
  ...counts,
});

const roomSnapshot = async (exam) => {
  const [pending, approved] = await Promise.all([
    LiveParticipant.countDocuments({ liveExam: exam._id, status: 'pending' }),
    LiveParticipant.countDocuments({ liveExam: exam._id, status: 'approved' }),
  ]);
  return { participantCount: pending + approved, pendingCount: pending, approvedCount: approved };
};

// --- Creation ---

/**
 * Hosting is the paid side of Live CBT; joining is free for any signed-in student.
 * The gate is the `live_cbt_host` entitlement, which a student pass buys or an administrator
 * grants. It is deliberately checked here rather than in the router so every caller, including
 * future internal ones, goes through it.
 */
export const createExam = async (hostId, input) => {
  if (!(await hasEntitlement(hostId, 'live_cbt_host'))) {
    throw new AppError(402, 'PLAN_REQUIRED', 'Hosting a live session needs an active plan.');
  }

  let subject = null;
  if (input.subject) {
    const filter = OBJECT_ID.test(input.subject)
      ? { _id: input.subject, isActive: true }
      : { code: String(input.subject).toUpperCase(), isActive: true };
    subject = await Subject.findOne(filter);
    if (!subject) throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
  }

  let questionIds = null;
  if (input.questionIds?.length) {
    const found = await Question.countDocuments({ _id: { $in: input.questionIds }, isActive: true });
    if (found !== input.questionIds.length) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'One or more selected questions do not exist.');
    }
    questionIds = input.questionIds;
  }

  // Validate the bank can satisfy the request before creating anything.
  const poolSize = questionIds
    ? questionIds.length
    : await Question.countDocuments({
        ...(subject ? { subject: subject._id } : {}),
        isActive: true,
        ...(input.difficulty && input.difficulty !== 'mixed' ? { difficulty: input.difficulty } : {}),
      });
  if (poolSize === 0) {
    throw new AppError(409, 'NO_QUESTIONS', 'No questions available for this configuration.');
  }
  if (input.numQuestions > poolSize) {
    throw new AppError(422, 'NOT_ENOUGH_QUESTIONS', `Only ${poolSize} questions available; requested ${input.numQuestions}.`);
  }

  let shareCode = generateShareCode();
  let exam = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      exam = await LiveExam.create({
        title: input.title,
        description: input.description ?? '',
        host: hostId,
        shareCode,
        subject: subject?._id,
        questionIds,
        numQuestions: input.numQuestions,
        durationMinutes: input.durationMinutes,
        maxParticipants: input.maxParticipants,
        difficulty: input.difficulty ?? 'mixed',
        shuffleQuestions: input.shuffleQuestions ?? true,
        shuffleOptions: input.shuffleOptions ?? true,
        negativeMarking: input.negativeMarking ?? 0,
        marksPerQuestion: input.marksPerQuestion ?? 1,
        allowReview: input.allowReview ?? true,
        status: 'waiting',
        totalPossible: Math.round(input.numQuestions * (input.marksPerQuestion ?? 1) * 100) / 100,
      });
      break;
    } catch (caught) {
      if (caught.code === 11000) {
        shareCode = generateShareCode();
        continue;
      }
      throw caught;
    }
  }
  if (!exam) throw new AppError(500, 'SHARE_CODE_COLLISION', 'Could not allocate a share link. Please retry.');
  return { ...toRoomView(exam, { participantCount: 0, approvedCount: 0 }), hostId: String(hostId) };
};

// --- Waiting room ---

export const getLanding = async (shareCode) => {
  const exam = await loadExamByCode(shareCode);
  const host = await User.findById(exam.host).select('fullName').lean();
  const [pending, approved] = await Promise.all([
    LiveParticipant.countDocuments({ liveExam: exam._id, status: 'pending' }),
    LiveParticipant.countDocuments({ liveExam: exam._id, status: 'approved' }),
  ]);
  return {
    ...toRoomView(exam, { participantCount: pending + approved, pendingCount: pending, approvedCount: approved }),
    hostName: host?.fullName ?? 'Host',
  };
};

export const requestJoin = async (userId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  if (['cancelled'].includes(exam.status)) {
    throw new AppError(409, 'EXAM_CLOSED', 'This examination is no longer accepting participants.');
  }
  if (['in_progress', 'completed', 'results_published'].includes(exam.status)) {
    throw new AppError(409, 'EXAM_STARTED', 'This examination has already started.');
  }
  if (String(exam.host) === String(userId)) {
    throw new AppError(409, 'HOST_CANNOT_JOIN', 'The host cannot join as a participant.');
  }
  if (exam.maxParticipants) {
    const active = await LiveParticipant.countDocuments({
      liveExam: exam._id,
      status: { $in: ['pending', 'approved'] },
    });
    if (active >= exam.maxParticipants) {
      throw new AppError(409, 'EXAM_FULL', 'This examination has reached its participant limit.');
    }
  }
  const user = await User.findById(userId).select('fullName').lean();
  try {
    const participant = await LiveParticipant.create({
      liveExam: exam._id,
      user: userId,
      displayName: user?.fullName ?? 'Participant',
    });
    const counts = await roomSnapshot(exam);
    publish(shareCode, 'participant.joined', { counts });
    publish(shareCode, 'room.updated', { counts });
    return { status: participant.status, counts };
  } catch (caught) {
    if (caught.code === 11000) {
      const existing = await LiveParticipant.findOne({ liveExam: exam._id, user: userId }).lean();
      if (existing?.status === 'rejected' || existing?.status === 'removed') {
        throw new AppError(403, 'JOIN_REJECTED', 'Your request was not approved for this examination.');
      }
      return { status: existing.status, duplicate: true, counts: await roomSnapshot(exam) };
    }
    throw caught;
  }
};

export const myMembership = async (userId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId }).lean();
  return {
    ...toRoomView(exam, await roomSnapshot(exam)),
    membership: participant
      ? { status: participant.status, attemptStatus: participant.attemptStatus, sequenceNumber: participant.sequenceNumber ?? null }
      : null,
  };
};

const listForHost = async (exam) => {
  const participants = await LiveParticipant.find({ liveExam: exam._id })
    .populate('user', 'fullName email')
    .sort({ createdAt: 1 })
    .lean();
  return participants.map((p) => ({
    userId: String(p.user?._id ?? p.user),
    displayName: p.displayName,
    email: p.user?.email ?? null,
    status: p.status,
    sequenceNumber: p.sequenceNumber ?? null,
    attemptStatus: p.attemptStatus,
    submittedAt: p.submittedAt ?? null,
    score: p.score ?? null,
    rank: p.rank ?? null,
  }));
};

export const hostRoom = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  return { ...toRoomView(exam, await roomSnapshot(exam)), participants: await listForHost(exam) };
};

const setApprovalStatus = async (exam, targetUserId, nextStatus) => {
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: targetUserId });
  if (!participant) throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found.');
  if (participant.status === nextStatus) return participant;
  if (nextStatus === 'approved') {
    // Atomic sequence allocation — the deterministic final tie-breaker.
    const updated = await LiveExam.findOneAndUpdate(
      { _id: exam._id },
      { $inc: { nextSequence: 1 } },
      { new: true },
    );
    participant.sequenceNumber = updated.nextSequence - 1;
    participant.approvedAt = new Date();
  }
  participant.status = nextStatus;
  await participant.save();
  return participant;
};

export const approveParticipant = async (hostId, shareCode, targetUserId) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (isTerminal(exam) || exam.status === 'in_progress') {
    throw new AppError(409, 'EXAM_LOCKED', 'Approvals are closed once the examination starts.');
  }
  const participant = await setApprovalStatus(exam, targetUserId, 'approved');
  const counts = await roomSnapshot(exam);
  publish(shareCode, 'participant.approved', { userId: String(targetUserId), counts });
  publish(shareCode, 'room.updated', { counts });
  return { status: participant.status, sequenceNumber: participant.sequenceNumber, counts };
};

export const rejectParticipant = async (hostId, shareCode, targetUserId) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (isTerminal(exam) || exam.status === 'in_progress') {
    throw new AppError(409, 'EXAM_LOCKED', 'Rejections are closed once the examination starts.');
  }
  await setApprovalStatus(exam, targetUserId, 'rejected');
  const counts = await roomSnapshot(exam);
  publish(shareCode, 'participant.rejected', { userId: String(targetUserId), counts });
  publish(shareCode, 'room.updated', { counts });
  return { status: 'rejected', counts };
};

export const approveAll = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (isTerminal(exam) || exam.status === 'in_progress') {
    throw new AppError(409, 'EXAM_LOCKED', 'Approvals are closed once the examination starts.');
  }
  const pending = await LiveParticipant.find({ liveExam: exam._id, status: 'pending' }).sort({ createdAt: 1 });
  let approved = 0;
  for (const p of pending) {
    if (exam.maxParticipants) {
      const active = await LiveParticipant.countDocuments({ liveExam: exam._id, status: 'approved' });
      if (active >= exam.maxParticipants) break;
    }
    await setApprovalStatus(await loadExamByCode(shareCode), p.user, 'approved');
    approved += 1;
  }
  const counts = await roomSnapshot(await loadExamByCode(shareCode));
  publish(shareCode, 'room.updated', { counts, approved });
  return { approved, counts };
};

// --- Lifecycle ---

const samplePool = async (exam) => {
  if (exam.questionIds?.length) {
    return Question.find({ _id: { $in: exam.questionIds }, isActive: true }).lean();
  }
  const query = { isActive: true };
  if (exam.subject) query.subject = exam.subject;
  if (exam.difficulty && exam.difficulty !== 'mixed') query.difficulty = exam.difficulty;
  return Question.aggregate([{ $match: query }, { $sample: { size: exam.numQuestions } }]);
};

const buildSnapshot = (pool, exam) => {
  const picked = shuffle([...pool]).slice(0, exam.numQuestions);
  const ordered = exam.shuffleQuestions ? shuffle(picked) : picked;
  return ordered.map((q) => {
    let options = [...q.options];
    let correctOption = q.correctIndex;
    if (exam.shuffleOptions) {
      const tagged = shuffle(options.map((option, i) => ({ option, i })));
      options = tagged.map((entry) => entry.option);
      correctOption = tagged.findIndex((entry) => entry.i === q.correctIndex);
    }
    return {
      question: q._id,
      stem: q.stem,
      options,
      correctOption,
      explanation: q.explanation,
      selectedOption: null,
    };
  });
};

export const startExam = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  // Idempotent double-start: a host double-click or retry returns current state.
  if (exam.status === 'in_progress') {
    return toRoomView(exam, await roomSnapshot(exam));
  }
  if (isTerminal(exam)) {
    throw new AppError(409, 'EXAM_CLOSED', 'This examination cannot be started.');
  }
  const approved = await LiveParticipant.find({ liveExam: exam._id, status: 'approved' });
  if (approved.length === 0) {
    throw new AppError(409, 'NO_APPROVED_PARTICIPANTS', 'Approve at least one participant before starting.');
  }
  const pool = await samplePool(exam);
  if (pool.length < exam.numQuestions) {
    throw new AppError(409, 'NOT_ENOUGH_QUESTIONS', 'The question bank no longer satisfies this examination.');
  }
  const now = new Date();
  exam.startedAt = now;
  exam.endsAt = new Date(now.getTime() + exam.durationMinutes * 60 * 1000);
  exam.status = 'in_progress';
  await exam.save();

  const ops = approved.map((p) => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { questions: buildSnapshot(pool, exam), attemptStatus: 'in_progress' } },
    },
  }));
  await LiveParticipant.bulkWrite(ops);

  const view = toRoomView(await loadExamByCode(shareCode), await roomSnapshot(exam));
  publish(shareCode, 'exam.started', { startedAt: exam.startedAt, endsAt: exam.endsAt });
  return view;
};

const finalizeParticipant = (participant, exam, finishedAt, timedOut) => {
  const result = computeScore({
    questions: participant.questions,
    marksPerQuestion: exam.marksPerQuestion,
    negativeMarking: exam.negativeMarking,
  });
  participant.correctCount = result.correctCount;
  participant.incorrectCount = result.incorrectCount;
  participant.unansweredCount = result.unansweredCount;
  participant.accuracy = result.accuracy;
  participant.score = result.score;
  participant.attemptStatus = timedOut ? 'timed_out' : 'submitted';
  participant.submittedAt = finishedAt;
  const start = exam.startedAt ? new Date(exam.startedAt).getTime() : new Date(participant.createdAt).getTime();
  participant.timeTakenSeconds = Math.max(1, Math.floor((new Date(finishedAt).getTime() - start) / 1000));
};

/** Lazily auto-submit every overdue in-progress attempt. Runs on every exam read path. */
export const sweepExpired = async (exam) => {
  if (exam.status !== 'in_progress' || !exam.endsAt || new Date(exam.endsAt).getTime() > Date.now()) return 0;
  const overdue = await LiveParticipant.find({ liveExam: exam._id, status: 'approved', attemptStatus: 'in_progress' });
  let count = 0;
  for (const p of overdue) {
    finalizeParticipant(p, exam, exam.endsAt, true);
    await p.save();
    count += 1;
  }
  if (count) publish(exam.shareCode, 'exam.timed_out', { autoSubmitted: count });
  return count;
};

export const endExam = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (exam.status !== 'in_progress') {
    throw new AppError(409, 'EXAM_NOT_RUNNING', 'Only a running examination can be ended.');
  }
  const now = new Date();
  const open = await LiveParticipant.find({ liveExam: exam._id, status: 'approved', attemptStatus: 'in_progress' });
  for (const p of open) {
    finalizeParticipant(p, exam, now, new Date(exam.endsAt).getTime() <= now.getTime());
    await p.save();
  }
  exam.status = 'completed';
  await exam.save();
  await computeRanks(exam._id);
  publish(shareCode, 'exam.ended', {});
  return toRoomView(await loadExamByCode(shareCode), await roomSnapshot(exam));
};

export const computeRanks = async (examId) => {
  const exam = await LiveExam.findById(examId);
  if (!exam) return [];
  const finished = await LiveParticipant.find({
    liveExam: exam._id,
    status: 'approved',
    attemptStatus: { $in: ['submitted', 'timed_out'] },
  });
  // Ensure every finished attempt has score fields (idempotent backfill).
  for (const p of finished) {
    if (p.score === undefined || p.score === null) {
      finalizeParticipant(p, exam, p.submittedAt ?? exam.endsAt ?? new Date(), p.attemptStatus === 'timed_out');
      await p.save();
    }
  }
  const ranked = rankParticipants(
    finished.map((p) => ({
      key: String(p._id),
      score: p.score ?? 0,
      accuracy: p.accuracy ?? 0,
      timeTakenSeconds: p.timeTakenSeconds,
      sequenceNumber: p.sequenceNumber,
    })),
  );
  const rankByKey = new Map(ranked.map((r) => [r.key, r.rank]));
  const ops = finished.map((p) => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { rank: rankByKey.get(String(p._id)) } } },
  }));
  if (ops.length) await LiveParticipant.bulkWrite(ops);
  exam.resultsComputedAt = new Date();
  await exam.save();
  return ranked;
};

export const publishResults = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (!['completed', 'in_progress'].includes(exam.status)) {
    throw new AppError(409, 'EXAM_NOT_COMPLETED', 'End the examination before publishing results.');
  }
  if (exam.status === 'in_progress') {
    await endExam(hostId, shareCode);
  }
  await computeRanks(exam._id);
  const fresh = await loadExamByCode(shareCode);
  fresh.status = 'results_published';
  fresh.resultsPublishedAt = new Date();
  await fresh.save();
  publish(shareCode, 'results.published', {});
  return toRoomView(fresh, await roomSnapshot(fresh));
};

export const cancelExam = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (isTerminal(exam) || exam.status === 'in_progress') {
    throw new AppError(409, 'EXAM_LOCKED', 'A running or finished examination cannot be cancelled.');
  }
  exam.status = 'cancelled';
  await exam.save();
  publish(shareCode, 'exam.cancelled', {});
  return toRoomView(exam, await roomSnapshot(exam));
};

// --- Question delivery & answers (authoritative timing enforced server-side) ---

const toExamView = (exam, participant) => ({
  shareCode: exam.shareCode,
  title: exam.title,
  status: exam.status,
  durationMinutes: exam.durationMinutes,
  startedAt: exam.startedAt,
  endsAt: exam.endsAt,
  serverTime: new Date().toISOString(),
  remainingSeconds: Math.max(0, Math.floor((new Date(exam.endsAt).getTime() - Date.now()) / 1000)),
  totalQuestions: participant.questions.length,
  attemptStatus: participant.attemptStatus,
  questions: participant.questions.map((q, index) => ({
    index,
    stem: q.stem,
    options: q.options,
    selectedOption: q.selectedOption,
  })),
});

export const getQuestions = async (userId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  await sweepExpired(exam);
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId });
  if (!participant || participant.status !== 'approved') {
    throw new AppError(403, 'NOT_APPROVED', 'Only approved participants can view questions.');
  }
  if (exam.status !== 'in_progress') {
    throw new AppError(409, 'EXAM_NOT_RUNNING', 'The examination has not started.');
  }
  if (participant.attemptStatus !== 'in_progress') {
    throw new AppError(409, 'ATTEMPT_CLOSED', 'Your attempt is already closed.');
  }
  return toExamView(exam, participant);
};

export const saveAnswer = async (userId, shareCode, { questionIndex, selectedOption }) => {
  const exam = await loadExamByCode(shareCode);
  await sweepExpired(exam);
  if (exam.status !== 'in_progress') {
    throw new AppError(409, 'EXAM_NOT_RUNNING', 'The examination is not running.');
  }
  // Atomic per-question write: concurrent autosaves on different questions never clobber.
  const filter = {
    liveExam: exam._id,
    user: userId,
    status: 'approved',
    attemptStatus: 'in_progress',
    [`questions.${questionIndex}.options`]: { $exists: true },
  };
  const result = await LiveParticipant.updateOne(filter, {
    $set: { [`questions.${questionIndex}.selectedOption`]: selectedOption },
  });
  if (result.matchedCount === 0) {
    const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId });
    if (!participant || participant.status !== 'approved') {
      throw new AppError(403, 'NOT_APPROVED', 'Only approved participants can answer.');
    }
    if (participant.attemptStatus !== 'in_progress') {
      throw new AppError(409, 'ATTEMPT_CLOSED', 'Your attempt is already closed.');
    }
    throw new AppError(400, 'INVALID_QUESTION_INDEX', 'Invalid question.');
  }
  return { questionIndex, selectedOption, serverTime: new Date().toISOString() };
};

/**
 * Apply an answer set the client kept while it was offline. Index-checked and last-write-wins, so a
 * retried batch is a no-op and an answer can never land on the wrong question.
 */
const applyAnswers = (participant, answers) => {
  let applied = 0;
  for (const { questionIndex, selectedOption } of answers) {
    const question = participant.questions[questionIndex];
    if (!question) continue;
    if (selectedOption !== null && selectedOption >= question.options.length) continue;
    if (question.selectedOption === selectedOption) continue;
    question.selectedOption = selectedOption;
    applied += 1;
  }
  return applied;
};

/**
 * A sitting closes on the clock (`sweepExpired`) or when the host ends the exam, and either can
 * happen while a participant's connection is down. Answers that reach us inside this window still
 * count, provided results are not out yet: refusing them is what used to lose a paper to a blip.
 */
const LATE_SUBMIT_GRACE_MS = 2 * 60 * 1000;

export const submitExam = async (userId, shareCode, answers = []) => {
  const exam = await loadExamByCode(shareCode);
  await sweepExpired(exam);
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId });
  if (!participant || participant.status !== 'approved') {
    throw new AppError(403, 'NOT_APPROVED', 'Only approved participants can submit.');
  }

  const wasOpen = participant.attemptStatus === 'in_progress';
  const endsAtMs = exam.endsAt ? new Date(exam.endsAt).getTime() : null;
  const withinGrace = endsAtMs !== null && Date.now() <= endsAtMs + LATE_SUBMIT_GRACE_MS;
  const canStillAccept = wasOpen || (exam.status !== 'results_published' && withinGrace);

  // A retry with nothing to add, or a batch that arrived after the sitting was sealed, returns the
  // stored outcome untouched: submit stays idempotent and never rewrites a released result.
  if (!canStillAccept) {
    return { ...participantSummary(participant, exam), answersAccepted: 0, answersRejected: answers.length > 0 };
  }

  const answersAccepted = applyAnswers(participant, answers);
  if (!wasOpen && answersAccepted === 0) {
    return { ...participantSummary(participant, exam), answersAccepted: 0 };
  }

  if (wasOpen) {
    const now = new Date();
    const timedOut = endsAtMs !== null && now.getTime() >= endsAtMs;
    finalizeParticipant(participant, exam, timedOut ? exam.endsAt : now, timedOut);
  } else {
    // Re-score against the answers that just arrived, keeping the original closure: the attempt
    // stays timed_out (or submitted) at the moment it actually ended.
    finalizeParticipant(
      participant,
      exam,
      participant.submittedAt ?? exam.endsAt ?? new Date(),
      participant.attemptStatus === 'timed_out',
    );
  }
  await participant.save();

  // A late batch can move a score after the host ended the exam, so the board is re-ranked.
  if (exam.status === 'completed') await computeRanks(exam._id);

  publish(shareCode, 'participant.submitted', { counts: await roomSnapshot(exam) });
  return { ...participantSummary(participant, exam), answersAccepted };
};

const participantSummary = (participant, exam) => ({
  attemptStatus: participant.attemptStatus,
  score: exam.status === 'results_published' ? participant.score : null,
  correctCount: exam.status === 'results_published' ? participant.correctCount : null,
  rank: exam.status === 'results_published' ? participant.rank : null,
  submittedAt: participant.submittedAt,
  resultsReleased: exam.status === 'results_published',
});

// --- Results ---

const toCorrectionView = (exam, participant) => {
  const result = computeScore({
    questions: participant.questions,
    marksPerQuestion: exam.marksPerQuestion,
    negativeMarking: exam.negativeMarking,
  });
  return {
    shareCode: exam.shareCode,
    title: exam.title,
    rank: participant.rank ?? null,
    score: participant.score ?? result.score,
    totalPossible: exam.totalPossible ?? result.totalPossible,
    correctCount: participant.correctCount ?? result.correctCount,
    incorrectCount: participant.incorrectCount ?? result.incorrectCount,
    unansweredCount: participant.unansweredCount ?? result.unansweredCount,
    accuracy: participant.accuracy ?? result.accuracy,
    timeTakenSeconds: participant.timeTakenSeconds ?? null,
    durationMinutes: exam.durationMinutes,
    attemptStatus: participant.attemptStatus,
    submittedAt: participant.submittedAt,
    corrections: exam.allowReview
      ? participant.questions.map((q, index) => ({
          index,
          stem: q.stem,
          options: q.options,
          selectedOption: q.selectedOption,
          correctOption: q.correctOption,
          isCorrect: q.selectedOption !== null && q.selectedOption === q.correctOption,
          explanation: q.explanation ?? null,
          marksAwarded:
            q.selectedOption === null || q.selectedOption === undefined
              ? 0
              : q.selectedOption === q.correctOption
                ? exam.marksPerQuestion
                : -exam.negativeMarking,
        }))
      : null,
  };
};

/**
 * A participant-facing standings row. Deliberately narrow: the opaque user id (so a client can
 * mark the caller), the display name, and the numbers the Hall of Fame shows. Never an email.
 */
const leaderboardRows = (participants, meId = null) =>
  participants.map((p) => ({
    userId: String(p.user?._id ?? p.user),
    displayName: p.displayName,
    rank: p.rank ?? null,
    score: p.score ?? null,
    correctCount: p.correctCount ?? null,
    accuracy: p.accuracy ?? null,
    timeTakenSeconds: p.timeTakenSeconds ?? null,
    attemptStatus: p.attemptStatus,
    isYou: meId != null && String(p.user?._id ?? p.user) === String(meId),
  }));

/** The ranked board, already submitted or timed out, best rank first. */
const boardParticipants = (examId) =>
  LiveParticipant.find({
    liveExam: examId,
    status: 'approved',
    attemptStatus: { $in: ['submitted', 'timed_out'] },
  })
    .sort({ rank: 1, score: -1, timeTakenSeconds: 1 })
    .lean();

export const getMyResult = async (userId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  if (exam.status !== 'results_published') {
    throw new AppError(409, 'RESULTS_NOT_PUBLISHED', 'Results have not been published yet.');
  }
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId });
  if (!participant || participant.status !== 'approved') {
    throw new AppError(403, 'NOT_APPROVED', 'Only participants can view results.');
  }
  if (participant.attemptStatus !== 'submitted' && participant.attemptStatus !== 'timed_out') {
    throw new AppError(409, 'NO_SUBMISSION', 'No submission found for this participant.');
  }
  const board = await boardParticipants(exam._id);
  return { ...toCorrectionView(exam, participant), leaderboard: leaderboardRows(board, userId) };
};

/**
 * The host reviewing one participant's sit: the same scored, corrected paper the participant sees,
 * plus their place on the board. Available once the sitting has ended, so a host can read a paper
 * before publishing the results.
 */
export const getParticipantResult = async (hostId, shareCode, userId) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  if (!['completed', 'results_published'].includes(exam.status)) {
    throw new AppError(409, 'EXAM_NOT_ENDED', 'Open a participant result once the sitting has ended.');
  }
  if (!OBJECT_ID.test(String(userId))) {
    throw new AppError(400, 'INVALID_PARTICIPANT', 'Invalid participant id.');
  }
  const participant = await LiveParticipant.findOne({ liveExam: exam._id, user: userId });
  if (!participant || participant.status !== 'approved') {
    throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'That student is not part of this session.');
  }
  if (!['submitted', 'timed_out'].includes(participant.attemptStatus)) {
    throw new AppError(409, 'NO_SUBMISSION', 'That student has not submitted a paper.');
  }
  const board = await boardParticipants(exam._id);
  return { ...toCorrectionView(exam, participant), displayName: participant.displayName, leaderboard: leaderboardRows(board, userId) };
};

export const hostDashboard = async (hostId, shareCode) => {
  const exam = await loadExamByCode(shareCode);
  requireHost(exam, hostId);
  await sweepExpired(exam);
  const participants = await LiveParticipant.find({ liveExam: exam._id, status: 'approved' })
    .populate('user', 'fullName email')
    .sort({ rank: 1, score: -1 })
    .lean();
  const started = participants.filter((p) => ['in_progress', 'submitted', 'timed_out'].includes(p.attemptStatus)).length;
  const submitted = participants.filter((p) => p.attemptStatus === 'submitted').length;
  const timedOut = participants.filter((p) => p.attemptStatus === 'timed_out').length;
  const noShow = participants.filter((p) => p.attemptStatus === 'waiting').length;

  // Question-level stats keyed by bank question id (robust to per-participant shuffling).
  const byQuestion = new Map();
  for (const p of participants) {
    if (!['submitted', 'timed_out'].includes(p.attemptStatus)) continue;
    for (const q of p.questions ?? []) {
      const key = String(q.question);
      if (!byQuestion.has(key)) byQuestion.set(key, { questionId: key, stem: q.stem, attempts: 0, correct: 0 });
      const entry = byQuestion.get(key);
      entry.attempts += 1;
      if (q.selectedOption !== null && q.selectedOption !== undefined && q.selectedOption === q.correctOption) {
        entry.correct += 1;
      }
    }
  }
  const questionStats = [...byQuestion.values()].map((entry) => ({
    ...entry,
    correctRate: entry.attempts ? Math.round((entry.correct / entry.attempts) * 10000) / 100 : 0,
  }));

  return {
    ...toRoomView(exam, await roomSnapshot(exam)),
    totals: {
      approved: participants.length,
      started,
      submitted,
      timedOut,
      noShow,
    },
    rankings: participants.map((p) => ({
      userId: String(p.user?._id ?? p.user),
      displayName: p.displayName,
      email: p.user?.email ?? null,
      attemptStatus: p.attemptStatus,
      score: p.score ?? null,
      correctCount: p.correctCount ?? null,
      accuracy: p.accuracy ?? null,
      timeTakenSeconds: p.timeTakenSeconds ?? null,
      rank: p.rank ?? null,
      sequenceNumber: p.sequenceNumber ?? null,
    })),
    questionStats,
  };
};

export const exportCsv = async (hostId, shareCode) => {
  const dashboard = await hostDashboard(hostId, shareCode);
  const header = 'rank,displayName,email,score,correctCount,accuracy,timeTakenSeconds,attemptStatus';
  const lines = dashboard.rankings.map((r) =>
    [r.rank ?? '', `"${String(r.displayName).replace(/"/g, '""')}"`, r.email ?? '', r.score ?? '', r.correctCount ?? '', r.accuracy ?? '', r.timeTakenSeconds ?? '', r.attemptStatus].join(','),
  );
  return `${header}\n${lines.join('\n')}\n`;
};

export const validateShareCodeParam = (value) => SHARE_CODE.test(String(value));
