import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One ad shown (served) to a student after a CBT session. Used for frequency
 * caps, one-ad-per-session idempotency and as the anchor for event dedupe.
 * `studentKey` is an HMAC — the student's identity is never stored.
 * Documents auto-expire after 2 days (TTL).
 */
const adServeSchema = new mongoose.Schema(
  {
    serveId: { type: String, required: true, unique: true },
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    studentKey: { type: String, required: true },
    sessionKey: { type: String, required: true, unique: true }, // HMAC(sessionType:sessionId) → one ad per session
    ranker: String,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

adServeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });
adServeSchema.index({ studentKey: 1, createdAt: -1 }); // frequency windows
adServeSchema.index({ campaign: 1 });

export const AdServe = mongoose.model('AdServe', adServeSchema);
