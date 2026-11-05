import { config } from '../config/env.js';

const clean = (u) => u.trim().replace(/\/$/, '');

/** Browser origins allowed to call the API (CORS + CSRF origin check share this list). */
export const allowedOrigins = () =>
  [...new Set([config.CLIENT_URL, config.ADS_CLIENT_URL, ...(config.ALLOWED_ORIGINS?.split(',') ?? [])].filter(Boolean).map(clean))];

export const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  const cleaned = clean(origin);
  if (allowedOrigins().includes(cleaned)) return true;

  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    // Allow the apex and any subdomain of testflow.com.ng over http/https
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (host === 'testflow.com.ng' || host.endsWith('.testflow.com.ng'))) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};
