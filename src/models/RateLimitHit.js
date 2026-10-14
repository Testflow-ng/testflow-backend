import mongoose from 'mongoose';

/** Shared (cross-instance) fixed-window counters; documents expire via TTL. */
const rateLimitHitSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    expireAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { versionKey: false },
);

export const RateLimitHit = mongoose.model('RateLimitHit', rateLimitHitSchema);
