import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import * as authService from '../services/auth.service.js';
import { setAuthCookies, clearAuthCookies, verifyRefreshToken } from '../services/token.service.js';
import { REFRESH_COOKIE } from '../config/cookies.js';
import { AppError } from '../utils/AppError.js';

export const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  res.status(201).json({ user });
});

export const login = asyncHandler(async (req, res) => {
  const user = await authService.login(req.body);
  setAuthCookies(res, user);
  res.status(200).json({ user });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id);
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
  // Issues fresh access + refresh JWTs. The model is currently stateless, so a
  // prior refresh token stays valid until natural expiry (see docs/api.md —
  // reuse-detecting rotation is a tracked enhancement).
  setAuthCookies(res, user);
  res.status(200).json({ user });
});

export const me = asyncHandler(async (req, res) => {
  // Flag if username is missing so the frontend can prompt the user
  // This now applies to both students and admins as requested
  const user = req.user.toJSON();
  const needsUsername = !user.username;

  res.status(200).json({
    user,
    meta: { needsUsername }
  });
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
  await authService.resendVerification(req.body.email);
  res.status(200).json({
    message: 'If that account exists and is unverified, a new verification link has been sent.',
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  res.status(200).json({ message: 'If that account exists, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.status(200).json({ message: 'Your password has been reset. Please sign in.' });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user._id, req.body);
  res.status(200).json({ user });
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body);
  clearAuthCookies(res);
  res.status(200).json({ message: 'Password changed successfully. Please sign in again.' });
});
