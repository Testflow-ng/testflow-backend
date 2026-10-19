import crypto from 'node:crypto';

/**
 * The token in a public result link.
 *
 * Opaque and unguessable: anyone who has the link sees the score, so the token must not be
 * derivable from the attempt it points at. Two hex groups (80 bits) read as a token rather than
 * as a mangled ObjectId, and hex keeps it URL-safe with no escaping in an href or an og:image.
 */
export const generateShareToken = () =>
  `${crypto.randomBytes(4).toString('hex')}.${crypto.randomBytes(6).toString('hex')}`;
