import crypto from 'node:crypto';

// Uppercase only: the join form uppercases input, so mixed-case codes used to
// fail for participants. Ambiguous characters (0/O, 1/I/L) stay excluded.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const codeLength = (length) => {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
};

/**
 * Generate a unique, URL-safe, non-sequential share code. Ambiguous
 * characters (0/O, 1/l) are excluded so codes survive copy-paste and dictation.
 * Callers must retry on a duplicate-key error; collisions are possible but rare.
 */
export const generateShareCode = (length = 9) => codeLength(length);
