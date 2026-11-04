const timestamp = () => new Date().toISOString();

/**
 * Minimal leveled logger. Intentionally small; swap for pino/winston if
 * structured logging or transports are needed later.
 */
export const logger = {
  info: (...args) => console.log(`[info] ${timestamp()}`, ...args),
  warn: (...args) => console.warn(`[warn] ${timestamp()}`, ...args),
  error: (...args) => console.error(`[error] ${timestamp()}`, ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[debug] ${timestamp()}`, ...args);
    }
  },
};
