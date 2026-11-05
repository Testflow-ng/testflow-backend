import { config } from '../config/env.js';

/**
 * The public origin the caller reached us on.
 *
 * For share links and user-facing URLs, returns the frontend/client origin rather than
 * internal backend domains (like onrender.com or api.testflow.com.ng).
 */
export const requestOrigin = (req) => {
  const candidate = req?.body?.origin || req?.get?.('origin') || req?.get?.('referer');
  if (candidate) {
    try {
      const u = new URL(candidate);
      if (u.protocol === 'https:' || (['localhost', '127.0.0.1'].includes(u.hostname) && !config.isProduction)) {
        return u.origin.replace(/\/+$/, '');
      }
    } catch {
      // not a valid URL
    }
  }

  const xHost = req?.get?.('x-forwarded-host');
  if (xHost && !xHost.includes('onrender.com') && !xHost.startsWith('api.')) {
    const proto = req?.get?.('x-forwarded-proto') || req.protocol || 'https';
    return `${proto}://${xHost}`.replace(/\/+$/, '');
  }

  if (config.CLIENT_URL) {
    return config.CLIENT_URL.replace(/\/+$/, '');
  }

  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
};

