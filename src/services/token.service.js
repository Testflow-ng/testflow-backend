import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  ORG_ACCESS_COOKIE,
  ORG_REFRESH_COOKIE,
  ORG_CSRF_COOKIE,
  ORG_REFRESH_PATH,
  REFRESH_PATH,
  accessCookieOptions,
  refreshCookieOptions,
  csrfCookieOptions,
  clearCookieOptions,
} from '../config/cookies.js';

/** `ap` = active product context (student | ads | …); `cid` = OAuth client id for bearer tokens. */
export const signAccessToken = (user, activeProduct, extra = {}) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0, ...(activeProduct ? { ap: activeProduct } : {}), ...extra },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN },
  );

export const signRefreshToken = (user, activeProduct) =>
  jwt.sign(
    { sub: String(user._id), tv: user.tokenVersion ?? 0, ...(activeProduct ? { ap: activeProduct } : {}) },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN },
  );

export const verifyAccessToken = (token) => jwt.verify(token, config.JWT_ACCESS_SECRET);
export const verifyRefreshToken = (token) => jwt.verify(token, config.JWT_REFRESH_SECRET);

export const newCsrfToken = () => crypto.randomBytes(32).toString('hex');

/** Issue (or rotate) both auth cookies plus a fresh CSRF token. Returns the CSRF token for the response body. */
export const setAuthCookies = (res, user, activeProduct) => {
  res.cookie(ACCESS_COOKIE, signAccessToken(user, activeProduct), accessCookieOptions());
  res.cookie(REFRESH_COOKIE, signRefreshToken(user, activeProduct), refreshCookieOptions());
  const csrf = newCsrfToken();
  res.cookie(CSRF_COOKIE, csrf, csrfCookieOptions());
  return csrf;
};

export const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, clearCookieOptions('/'));
  res.clearCookie(REFRESH_COOKIE, clearCookieOptions(REFRESH_PATH));
  res.clearCookie(CSRF_COOKIE, clearCookieOptions('/'));
};

/**
 * Session for an organisation's site. Tokens are marked `org` and carry no token version, so a Testflow
 * sign-out (which bumps the version) does not end them. Suspension still bites: every request re-checks
 * the person's membership.
 */
export const setOrgCookies = (res, user) => {
  const sub = String(user._id);
  const access = jwt.sign({ sub, role: 'student', org: true, ap: 'student' }, config.JWT_ACCESS_SECRET, { expiresIn: config.JWT_ACCESS_EXPIRES_IN });
  const refresh = jwt.sign({ sub, org: true }, config.JWT_REFRESH_SECRET, { expiresIn: config.JWT_REFRESH_EXPIRES_IN });
  res.cookie(ORG_ACCESS_COOKIE, access, accessCookieOptions());
  res.cookie(ORG_REFRESH_COOKIE, refresh, { ...refreshCookieOptions(), path: ORG_REFRESH_PATH });
  res.cookie(ORG_CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
};

export const clearOrgCookies = (res) => {
  res.clearCookie(ORG_ACCESS_COOKIE, clearCookieOptions('/'));
  res.clearCookie(ORG_REFRESH_COOKIE, clearCookieOptions(ORG_REFRESH_PATH));
  res.clearCookie(ORG_CSRF_COOKIE, clearCookieOptions('/'));
};
