import { config } from '../config/env.js';

const clean = (u) => u.trim().replace(/\/$/, '');

/** Browser origins allowed to call the API (CORS + CSRF origin check share this list). */
export const allowedOrigins = () =>
  [...new Set([config.CLIENT_URL, config.ADS_CLIENT_URL, ...(config.ALLOWED_ORIGINS?.split(',') ?? [])].filter(Boolean).map(clean))];

export const isAllowedOrigin = (origin) => allowedOrigins().includes(origin);
