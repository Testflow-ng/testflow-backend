import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { AdvertiserProfile } from '../models/AdvertiserProfile.js';
import { AppError } from '../utils/AppError.js';
import {
  PRODUCTS, effectiveMemberships, hasMembership, defaultActiveProduct, isJoinable, isProduct,
} from '../utils/identity.js';
import * as authService from './auth.service.js';
import { recordAction } from './audit.service.js';

const emailHash = (email) => crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 16);

export const membershipView = (user) =>
  effectiveMemberships(user).map((m) => ({ product: m.product, role: m.role, joinedAt: m.joinedAt ?? null }));

/** Small per-product summaries for the app shell (no sensitive data). */
export const profilesFor = async (user) => {
  const out = {};
  for (const m of effectiveMemberships(user)) {
    if (m.product === 'student') {
      out.student = {
        username: user.username ?? null, level: user.level ?? null, department: user.department ?? null,
        streakCount: user.streakCount ?? 0, hasMigrated: !!user.hasMigrated,
      };
    } else if (m.product === 'ads') {
      const p = await AdvertiserProfile.findOne({ user: user._id }).select('businessName contactPhone').lean();
      out.ads = { businessName: p?.businessName ?? null, contactPhone: p?.contactPhone ?? null };
    }
  }
  return out;
};

/** The standard account response used by register/login/me/switch/memberships. */
export const accountPayload = async (user, activeProduct) => ({
  user,
  memberships: membershipView(user),
  activeProduct: defaultActiveProduct(user, activeProduct),
  profiles: await profilesFor(user),
});

const noMembership = (product) => {
  const err = new AppError(403, 'NO_MEMBERSHIP', `This account does not have access to ${product}.`);
  err.details = { product, canJoin: isJoinable(product) };
  return err;
};

const requireAdsProfile = (profile) => {
  if (!profile?.businessName?.trim()) {
    const err = new AppError(422, 'VALIDATION_ERROR', 'Business name is required for an Ads account.');
    err.fields = { 'profile.businessName': 'Business name is required for an Ads account.' };
    throw err;
  }
};

export const registerAccount = async ({ product = 'student', fullName, email, password, profile }, req) => {
  if (!isProduct(product)) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown product.');
  if (product === 'ads') requireAdsProfile(profile);

  let user;
  try {
    user = await User.create({
      fullName, email, passwordHash: password, role: 'student', isEmailVerified: true,
      memberships: [{ product, role: PRODUCTS[product].defaultRole }],
      ...(product === 'student' ? { verificationCode: authService.generateVerificationCode() } : {}),
    });
  } catch (e) {
    if (e?.code === 11000) {
      const err = new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      err.details = { canJoin: isJoinable(product), product, hint: 'Sign in, then add this product with POST /api/auth/memberships.' };
      throw err;
    }
    throw e;
  }
  if (product === 'ads') {
    try {
      await AdvertiserProfile.create({ user: user._id, businessName: profile.businessName.trim(), contactPhone: profile.contactPhone });
    } catch (e) {
      await User.deleteOne({ _id: user._id });
      throw e;
    }
  }
  await recordAction({ actorId: user._id, action: 'AUTH_REGISTER', targetId: user._id, targetType: 'User', metadata: { product }, req });
  return user;
};

/** Verifies credentials (constant-time for unknown emails) and, if `product` is given, membership. */
export const loginAccount = async ({ email, password, product }, req) => {
  let user;
  try {
    user = await authService.login({ email, password });
  } catch (e) {
    if (e.code === 'INVALID_CREDENTIALS') {
      await recordAction({ action: 'AUTH_LOGIN_FAILED', targetType: 'User', metadata: { emailHash: emailHash(email), product }, req });
    }
    throw e;
  }
  if (product && !hasMembership(user, product)) {
    await recordAction({ actorId: user._id, action: 'AUTH_LOGIN_FAILED', targetId: user._id, targetType: 'User', metadata: { reason: 'NO_MEMBERSHIP', product }, req });
    throw noMembership(product);
  }
  const activeProduct = defaultActiveProduct(user, product);
  await recordAction({ actorId: user._id, action: 'AUTH_LOGIN', targetId: user._id, targetType: 'User', metadata: { product: activeProduct }, req });
  return { user, activeProduct };
};

export const addMembership = async (user, { product, profile }, req) => {
  if (!isJoinable(product)) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown product.');
  if (hasMembership(user, product)) throw new AppError(409, 'ALREADY_MEMBER', 'This account already has access to that product.');
  if (product === 'ads') requireAdsProfile(profile);

  const entry = { product, role: PRODUCTS[product].defaultRole, joinedAt: new Date() };
  const stored = user.memberships ?? [];
  // Atomic: a concurrent duplicate request cannot add the same product twice.
  const res = stored.length
    ? await User.updateOne({ _id: user._id, 'memberships.product': { $ne: product } }, { $push: { memberships: entry } })
    : await User.updateOne({ _id: user._id, 'memberships.0': { $exists: false } }, { $set: { memberships: [...effectiveMemberships(user), entry] } });
  if (!res.modifiedCount) throw new AppError(409, 'ALREADY_MEMBER', 'This account already has access to that product.');

  if (product === 'ads') {
    await AdvertiserProfile.updateOne(
      { user: user._id }, { $setOnInsert: { businessName: profile.businessName.trim(), contactPhone: profile.contactPhone } }, { upsert: true },
    );
  }
  if (product === 'student') {
    // Post-UTME verification code for accounts that were created as ads-only.
    await User.updateOne({ _id: user._id, verificationCode: { $exists: false } }, { $set: { verificationCode: authService.generateVerificationCode() } });
  }
  await recordAction({ actorId: user._id, action: 'MEMBERSHIP_ADD', targetId: user._id, targetType: 'User', metadata: { product }, req });
  return User.findById(user._id).select('+tokenVersion');
};

export const switchProduct = async (user, product, req) => {
  if (!hasMembership(user, product)) throw noMembership(product);
  await recordAction({ actorId: user._id, action: 'PRODUCT_SWITCH', targetId: user._id, targetType: 'User', metadata: { product }, req });
  return product;
};
