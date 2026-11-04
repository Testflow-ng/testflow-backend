import crypto from 'node:crypto';

export const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/; // base64url(SHA-256) = 43 chars

/** S256 challenge for a verifier (RFC 7636). */
export const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

export const verifyPkce = (verifier, challenge) => {
  if (!CODE_VERIFIER_RE.test(verifier ?? '') || !CODE_CHALLENGE_RE.test(challenge ?? '')) return false;
  const a = Buffer.from(challengeFor(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
