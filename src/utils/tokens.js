import crypto from 'node:crypto';

/** Cryptographically-random, URL-safe opaque token (emailed to the user). */
export const generateToken = () => crypto.randomBytes(32).toString('hex');

/** Store only the hash of a token so a DB leak can't be used to hijack accounts. */
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
