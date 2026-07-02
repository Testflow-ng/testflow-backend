import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_PATH,
  accessCookieOptions,
  refreshCookieOptions,
  clearCookieOptions,
} from '../config/cookies.js';

export const signAccessToken = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN },
  );

export const signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion ?? 0 }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  });

export const verifyAccessToken = (token) => jwt.verify(token, config.JWT_ACCESS_SECRET);
export const verifyRefreshToken = (token) => jwt.verify(token, config.JWT_REFRESH_SECRET);

/** Issue (or rotate) both auth cookies for a user. */
export const setAuthCookies = (res, user) => {
  res.cookie(ACCESS_COOKIE, signAccessToken(user), accessCookieOptions());
  res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions());
};

export const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, clearCookieOptions('/'));
  res.clearCookie(REFRESH_COOKIE, clearCookieOptions(REFRESH_PATH));
};
