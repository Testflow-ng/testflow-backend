import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { generateToken, hashToken } from '../utils/tokens.js';
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Constant dummy hash so login runs bcrypt even for unknown emails (blunts timing enumeration).
const DUMMY_HASH = bcrypt.hashSync('timing-attack-guard', 12);

const issueVerification = async (user) => {
  const token = generateToken();
  user.emailVerifyTokenHash = hashToken(token);
  user.emailVerifyExpires = new Date(Date.now() + VERIFY_TTL_MS);
  await user.save();
  await sendVerificationEmail(user, token);
};

export const register = async ({ fullName, email, password }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  let user;
  try {
    user = await User.create({
      fullName,
      email,
      passwordHash: password,
      role: 'student',
      isEmailVerified: true,
    });
  } catch (caught) {
    // A concurrent request can slip past the findOne check and trip a unique
    // index. Map the duplicate-key error to a clear, field-aware message.
    if (caught?.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw caught;
  }

  // Verification emails disabled per request
  // await issueVerification(user);

  return user;
};

export const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
};

export const getRefreshedUser = async (payload) => {
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || (user.tokenVersion ?? 0) !== payload.tv) {
    throw new AppError(401, 'INVALID_REFRESH', 'Your session has expired. Please sign in again.');
  }
  return user;
};

export const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
};

export const verifyEmail = async (rawToken) => {
  const user = await User.findOne({
    emailVerifyTokenHash: hashToken(rawToken),
    emailVerifyExpires: { $gt: new Date() },
  }).select('+emailVerifyTokenHash +emailVerifyExpires');
  if (!user) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This verification link is invalid or has expired.');
  }
  user.isEmailVerified = true;
  user.emailVerifyTokenHash = undefined;
  user.emailVerifyExpires = undefined;
  await user.save();
  return user;
};

export const resendVerification = async (email) => {
  const user = await User.findOne({ email });
  if (user && !user.isEmailVerified) {
    await issueVerification(user);
  }
};

export const forgotPassword = async (email) => {
  const user = await User.findOne({ email });
  if (user) {
    const token = generateToken();
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpires = new Date(Date.now() + RESET_TTL_MS);
    await user.save();
    await sendPasswordResetEmail(user, token);
  }
};

export const resetPassword = async (rawToken, password) => {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(rawToken),
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpires +tokenVersion');
  if (!user) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired.');
  }
  user.passwordHash = password; // pre-save hook hashes it
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // sign out all existing sessions
  await user.save();
  return user;
};

export const updateProfile = async (userId, { fullName, showOnLeaderboard }) => {
  const updates = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (showOnLeaderboard !== undefined) updates.showOnLeaderboard = showOnLeaderboard;

  const user = await User.findByIdAndUpdate(
    userId,
    updates,
    { new: true, runValidators: true }
  );
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  return user;
};

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordOk) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Incorrect current password.');
  }

  user.passwordHash = newPassword;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  return user;
};
