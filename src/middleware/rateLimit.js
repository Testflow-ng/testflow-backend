import { AppError } from '../utils/AppError.js';
import { RateLimitHit } from '../models/RateLimitHit.js';

const tooMany = () => new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.');

/** In-memory fixed window (per process). For high-volume, low-risk routes. */
export const rateLimit = ({ windowMs, max, key = (req) => req.ip }) => {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, _res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    return entry.count > max ? next(tooMany()) : next();
  };
};

/**
 * Shared fixed window stored in MongoDB, so limits hold across every API
 * instance. One atomic upsert per request — use for auth, uploads, checkout.
 * If the database call itself fails the request is allowed (fail-open).
 */
export const sharedRateLimit = ({ name, windowMs, max, key = (req) => req.ip }) => async (req, _res, next) => {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = `${name}:${key(req)}:${windowStart}`;
  const hit = async () =>
    RateLimitHit.findOneAndUpdate(
      { key: id }, { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(windowStart + windowMs + 60_000) } }, { upsert: true, new: true },
    );
  try {
    let doc;
    try {
      doc = await hit();
    } catch (e) {
      if (e?.code !== 11000) throw e;
      doc = await hit(); // concurrent first insert → retry once
    }
    return doc.count > max ? next(tooMany()) : next();
  } catch {
    return next();
  }
};
