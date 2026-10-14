import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import * as authService from '../services/auth.service.js';
import * as identity from '../services/identity.service.js';
import * as oauth from '../services/oauth.service.js';
import { recordAction } from '../services/audit.service.js';
import { setAuthCookies, clearAuthCookies, verifyRefreshToken, newCsrfToken } from '../services/token.service.js';
import { csrfCookieOptions, CSRF_COOKIE, REFRESH_COOKIE } from '../config/cookies.js';
import { AppError } from '../utils/AppError.js';
import { withMinDuration } from '../utils/timing.js';

/** Create the session (cookies + CSRF token) and send the standard account payload. */
const sendSession = async (res, status, user, activeProduct) => {
  const payload = await identity.accountPayload(user, activeProduct);
  const csrfToken = setAuthCookies(res, user, payload.activeProduct);
  res.status(status).json({ ...payload, csrfToken });
};

export const register = asyncHandler(async (req, res) => {
  const user = await identity.registerAccount(req.body, req);
  // Unchanged behaviour: registering does not sign in; the client logs in next.
  res.status(201).json({ user, memberships: identity.membershipView(user) });
});

export const login = asyncHandler(async (req, res) => {
  const { user, activeProduct } = await identity.loginAccount(req.body, req);
  await sendSession(res, 200, user, activeProduct);
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id);
  await recordAction({ actorId: req.user._id, action: 'AUTH_LOGOUT', targetId: req.user._id, targetType: 'User', req });
  clearAuthCookies(res);
  res.status(204).send();
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    throw new AppError(401, 'INVALID_REFRESH', 'Your session has expired. Please sign in again.');
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError(401, 'INVALID_REFRESH', 'Your session has expired. Please sign in again.');
  }

  const user = await authService.getRefreshedUser(payload);
  // Issues fresh access + refresh JWTs and keeps the active product context.
  await sendSession(res, 200, user, payload.ap);
});

export const me = asyncHandler(async (req, res) => {
  // Flag if username is missing so the frontend can prompt the user
  const user = req.user;
  const needsUsername = !user.username;

  // Update lastActiveAt periodically (at most once every 5 minutes to avoid DB spam)
  const now = new Date();
  if (!user.lastActiveAt || now - user.lastActiveAt > 5 * 60 * 1000) {
    user.lastActiveAt = now;
    await user.save();
  }

  let csrfToken = req.cookies?.[CSRF_COOKIE];
  if (!csrfToken && req.authVia === 'cookie') {
    csrfToken = newCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
  }
  const payload = await identity.accountPayload(user, req.activeProduct);
  res.status(200).json({ ...payload, user: user.toJSON(), meta: { needsUsername }, csrfToken: csrfToken ?? null });
});

/** Add a product to the signed-in account (or to the account proven by email+password). */
export const addMembership = asyncHandler(async (req, res) => {
  let user = req.user;
  if (!user) {
    const { email, password, product } = req.body;
    if (!email || !password) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in, or send email and password.');
    ({ user } = await identity.loginAccount({ email, password }, req));
    req.body.product = product;
  }
  const updated = await identity.addMembership(user, req.body, req);
  await sendSession(res, 201, updated, req.body.product);
});

export const switchProduct = asyncHandler(async (req, res) => {
  const product = await identity.switchProduct(req.user, req.body.product, req);
  const user = await User.findById(req.user._id).select('+tokenVersion');
  await sendSession(res, 200, user, product);
});

export const oauthAuthorize = asyncHandler(async (req, res) => res.json(await oauth.issueCode(req.user, req.body, req)));
export const oauthToken = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await oauth.exchangeCode(req.body, req));
});

export const setUsername = asyncHandler(async (req, res) => {
  const { username } = req.body;

  if (!username || username.length < 3) {
    throw new AppError(400, 'INVALID_USERNAME', 'Username must be at least 3 characters.');
  }

  // Check if username is taken
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) {
    throw new AppError(409, 'USERNAME_TAKEN', 'This username is already taken.');
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { username: username.toLowerCase() },
    { new: true, runValidators: true }
  );

  res.status(200).json({ user });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.body.token);
  res.status(200).json({ user });
});

export const resendVerification = asyncHandler(async (req, res) => {
  await withMinDuration(400, () => authService.resendVerification(req.body.email));
  res.status(200).json({
    message: 'If that account exists and is unverified, a new verification link has been sent.',
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  // Same response, and never faster than 400 ms, whether or not the account exists.
  await withMinDuration(400, async () => {
    const user = await authService.forgotPassword(req.body.email);
    if (user) await recordAction({ actorId: user._id, action: 'PASSWORD_RESET_REQUEST', targetId: user._id, targetType: 'User', req });
  });
  res.status(200).json({ message: 'If that account exists, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  // tokenVersion is bumped inside the service: every session on every product is signed out.
  const user = await authService.resetPassword(req.body.token, req.body.password);
  await recordAction({ actorId: user._id, action: 'PASSWORD_RESET', targetId: user._id, targetType: 'User', metadata: { sessionsRevoked: true }, req });
  res.status(200).json({ message: 'Your password has been reset. Please sign in.' });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user._id, req.body);
  res.status(200).json({ user });
});

export const migrateToUniversity = asyncHandler(async (req, res) => {
  const user = await authService.migrateToUniversity(req.user._id, req.body);
  res.status(200).json({ user });
});

export const updateUtmeData = asyncHandler(async (req, res) => {
  const user = await authService.updateUtmeData(req.user._id, req.body);
  res.status(200).json({ user });
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body);
  await recordAction({ actorId: req.user._id, action: 'PASSWORD_CHANGE', targetId: req.user._id, targetType: 'User', metadata: { sessionsRevoked: true }, req });
  clearAuthCookies(res);
  res.status(200).json({ message: 'Password changed successfully. Please sign in again.' });
});
