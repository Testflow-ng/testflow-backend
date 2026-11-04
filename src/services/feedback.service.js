import crypto from 'node:crypto';
import { Feedback } from '../models/Feedback.js';
import { AppError } from '../utils/AppError.js';

const KINDS = ['problem', 'idea', 'other'];
const STATUSES = ['open', 'in_review', 'resolved'];

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 1000;
const REPLY_MAX = 500;

/** Only what a reader of the queue needs to know about the author. */
const STUDENT_FIELDS = 'fullName username matricNumber';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whitespace and case are noise: "The timer  stopped." and "the timer stopped." are the same
 * note and the same retry. Everything else is left alone, because a differing word is a
 * differing report.
 */
const fingerprint = (message) =>
  crypto
    .createHash('sha256')
    .update(message.replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex');

const identityOf = (student) =>
  student && typeof student === 'object' && student.fullName
    ? {
        fullName: student.fullName,
        username: student.username ?? null,
        matricNumber: student.matricNumber ?? null,
      }
    : null;

/**
 * The public shape.
 *
 * `messageHash` never leaves the service, and neither does `resolvedBy`: which admin answered
 * is an internal fact (the audit log holds it), while `resolvedAt` is harmless and sometimes
 * useful for "how long did we take".
 */
const toView = (doc) => ({
  id: String(doc._id),
  kind: doc.kind,
  rating: doc.rating ?? null,
  screen: doc.screen ?? null,
  message: doc.message,
  status: doc.status,
  reply: doc.reply ?? null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  resolvedAt: doc.resolvedAt ?? null,
  student: identityOf(doc.student),
});

const loadWithStudent = (query) => query.populate('student', STUDENT_FIELDS);

/**
 * Send a note. `student` comes from the authenticated user, never from the body.
 *
 * A stuck client retrying the same submit must not fill the queue, so the same words from the
 * same student inside a day answer with the row that already exists instead of creating a
 * second one. That makes a retry idempotent, which is what a retry should be.
 */
export const createFeedback = async ({ student, kind, rating = null, screen = null, message }) => {
  const text = String(message ?? '').trim();

  if (text.length < MESSAGE_MIN) {
    throw new AppError(422, 'MESSAGE_TOO_SHORT', `Tell us a little more, at least ${MESSAGE_MIN} characters.`);
  }
  if (text.length > MESSAGE_MAX) {
    throw new AppError(422, 'MESSAGE_TOO_LONG', `A message can be at most ${MESSAGE_MAX} characters.`);
  }
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new AppError(422, 'INVALID_RATING', 'A rating has to be a whole number from 1 to 5.');
  }

  const messageHash = fingerprint(text);
  const seenSince = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const duplicate = await loadWithStudent(
    Feedback.findOne({ student, messageHash, createdAt: { $gte: seenSince } }).sort({ createdAt: -1 }),
  );
  if (duplicate) return toView(duplicate);

  const created = await Feedback.create({
    student,
    // The validator already restricts this; the fallback keeps a direct service call honest.
    kind: KINDS.includes(kind) ? kind : 'other',
    rating,
    screen: screen ? String(screen).trim().slice(0, 80) : null,
    message: text,
    messageHash,
  });

  return toView(await loadWithStudent(Feedback.findById(created._id)));
};

/** One student's own notes, newest first. There is no way to ask for anyone else's. */
export const listForStudent = async (studentId, { limit = 50 } = {}) => {
  const docs = await loadWithStudent(
    Feedback.find({ student: studentId }).sort({ createdAt: -1 }).limit(limit),
  );
  return docs.map(toView);
};

/**
 * The admin queue: the entries, and the counts the filter labels are drawn from.
 *
 * One call returns both, because the labels and the list are read together and two calls would
 * flicker between them. The counts are over the *whole* queue rather than the current filter,
 * so "Open 1" does not become "Open 0" while the admin is looking at Resolved.
 */
export const listForAdmin = async ({ status, kind, page = 1, limit = 50 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (kind) filter.kind = kind;

  const [docs, byStatus, total, rated] = await Promise.all([
    loadWithStudent(
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ),
    Feedback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Feedback.countDocuments(filter),
    // Unrated bug reports must not drag the average toward zero.
    Feedback.aggregate([
      { $match: { rating: { $ne: null } } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);

  const counts = new Map(byStatus.map((entry) => [entry._id, entry.count]));
  const ratedCount = rated[0]?.count ?? 0;

  return {
    feedback: docs.map(toView),
    counts: {
      open: counts.get('open') ?? 0,
      in_review: counts.get('in_review') ?? 0,
      resolved: counts.get('resolved') ?? 0,
      total: [...counts.values()].reduce((sum, n) => sum + n, 0),
      averageRating: ratedCount ? Math.round(rated[0].average * 10) / 10 : null,
      ratedCount,
    },
    page,
    total,
  };
};

/**
 * Move an entry along, and answer it.
 *
 * Every transition is legal in every direction: a decision has to be undoable, so `resolved`
 * can go back to `open` and the resolved bookkeeping is cleared when it does. A reply is
 * student-visible, and an empty string clears it rather than storing one.
 */
export const updateForAdmin = async (id, { status, reply }, actorId) => {
  const feedback = await Feedback.findById(id);
  if (!feedback) {
    throw new AppError(404, 'FEEDBACK_NOT_FOUND', 'That feedback no longer exists.');
  }

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      throw new AppError(422, 'INVALID_STATUS', 'Unknown status.');
    }
    feedback.status = status;
    feedback.resolvedBy = status === 'resolved' ? actorId : undefined;
    feedback.resolvedAt = status === 'resolved' ? new Date() : undefined;
  }

  if (reply !== undefined) {
    const text = String(reply ?? '').trim();
    if (text.length > REPLY_MAX) {
      throw new AppError(422, 'REPLY_TOO_LONG', `A reply can be at most ${REPLY_MAX} characters.`);
    }
    feedback.reply = text || null;
  }

  await feedback.save();
  return toView(await loadWithStudent(Feedback.findById(feedback._id)));
};
