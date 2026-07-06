import { config } from './env.js';

const ACCESS_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

export const ACCESS_COOKIE = 'tf_access';
export const REFRESH_COOKIE = 'tf_refresh';
// Refresh cookie is scoped to the refresh route so it is not sent on every request.
export const REFRESH_PATH = '/api/auth/refresh';

const baseOptions = () => ({
  httpOnly: true,
  secure: config.isProduction,
  // With Vercel proxying, cookies are now First-Party.
  // SameSite=Lax is more compatible and secure than 'None'.
  sameSite: config.isProduction ? 'lax' : 'lax',
  domain: config.COOKIE_DOMAIN || undefined,
});

export const accessCookieOptions = () => ({ ...baseOptions(), path: '/', maxAge: ACCESS_MAX_AGE });

export const refreshCookieOptions = () => ({
  ...baseOptions(),
  path: REFRESH_PATH,
  maxAge: REFRESH_MAX_AGE,
});

export const clearCookieOptions = (path) => ({ ...baseOptions(), path });
