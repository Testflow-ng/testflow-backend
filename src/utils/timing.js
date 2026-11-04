/** Run `fn`, but never answer sooner than `minMs` (blunts timing-based account enumeration). */
export const withMinDuration = async (minMs, fn) => {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const left = minMs - (Date.now() - start);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
};
