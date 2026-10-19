import { ExamSession } from '../models/ExamSession.js';
import { AppError } from '../utils/AppError.js';
import { generateShareToken } from '../utils/shareToken.js';

/**
 * Sharing a finished attempt.
 *
 * The link is a token on the attempt, not the attempt id, because anyone holding the link sees
 * the score. It is minted once: reopening the share dialog answers with the token that already
 * exists, so a student who shares twice never ends up with two URLs saying the same thing.
 * Revoking is clearing the field; nothing else has to happen, because nothing else is keyed on it.
 */

/** First name, or the handle, or nothing: the card is public, so it carries the least that reads as a person. */
export const cardName = (user) => {
  const full = String(user?.fullName ?? '').trim();
  if (full) return full.split(/\s+/)[0];
  return String(user?.username ?? '').trim() || 'A student';
};

const shareView = (session, origin) => {
  const url = `${origin}/r/${session.shareToken}`;
  return { token: session.shareToken, url, imageUrl: `${url}/og.png` };
};

/**
 * Mint (or return) the link for an attempt the caller owns.
 *
 * 404 rather than 403 for someone else's attempt: a 403 would confirm that the attempt exists.
 * An unfinished attempt has no score to publish, so it is a 409.
 */
export const mintShare = async (studentId, sessionId, origin) => {
  const session = await ExamSession.findOne({ _id: sessionId, student: studentId });
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Exam session not found.');
  }
  if (session.status !== 'submitted') {
    throw new AppError(409, 'SESSION_IN_PROGRESS', 'Finish the paper before sharing it.');
  }

  if (!session.shareToken) {
    // The sparse unique index is what keeps two attempts from ever sharing a token. A collision
    // is vanishingly unlikely; retrying is cheaper than reasoning about it.
    for (let attempt = 0; attempt < 3 && !session.shareToken; attempt += 1) {
      session.shareToken = generateShareToken();
      try {
        await session.save();
      } catch (error) {
        if (error?.code !== 11000) throw error;
        session.shareToken = undefined;
      }
    }
    if (!session.shareToken) {
      throw new AppError(500, 'SHARE_TOKEN_FAILED', 'Could not create a share link. Please try again.');
    }
  }

  return shareView(session, origin);
};

/**
 * Everything the public page and its card print, and nothing else.
 *
 * No email, no matric number, no other attempts, no answers: the card carries the name the
 * student published, the subject, the score and the count, which is the whole privacy story.
 * Returns null for an unknown or revoked token, so the caller decides between a 404 page and a
 * 404 envelope.
 */
export const findShare = async (token) => {
  const session = await ExamSession.findOne({ shareToken: token })
    .populate('student', 'fullName username')
    .lean();

  if (!session) return null;

  return {
    token: session.shareToken,
    name: cardName(session.student),
    subjectCode: session.subjectCode,
    score: session.score ?? 0,
    correctCount: session.correctCount ?? 0,
    totalQuestions: session.totalQuestions ?? 0,
    submittedAt: session.submittedAt ?? null,
  };
};
