import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { AppError } from '../utils/AppError.js';
import { generateToken, hashToken } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';
import { entitlementsFor, requireWritableSubscription } from './entitlements.js';
import { recordAction } from './audit.service.js';
import { sendOrgStudentEmail } from './email.service.js';
import { orgSiteUrl } from './orgNotify.service.js';
import * as authService from './auth.service.js';

/**
 * Students do not sign themselves up on an organisation's site. The organisation adds their email
 * addresses and each person gets a message from it: a link to choose a password if they are new, or
 * a sign-in link if they already have a Testflow account. That keeps the roster in the owner's
 * hands: nobody reaches an organisation's exams without having been added.
 */

const SETUP_TTL_MS = 7 * 24 * 3600 * 1000;

const nameFromEmail = (email) =>
  email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 120) || 'Student';

const mail = (promise) => promise.catch((err) => logger.error('[org-students] email failed:', err.message));

/**
 * Add each address as a student of `org`. Returns one line per address:
 * `added` (new account), `linked` (existing account, now a student here) or `already` (nothing to do).
 */
export const addStudents = async (org, emails, req) => {
  await requireWritableSubscription(org._id);
  const list = [...new Set(emails.map((e) => String(e).trim().toLowerCase()))];
  const existingUsers = await User.find({ email: { $in: list } }).select('_id email').lean();
  const byEmail = new Map(existingUsers.map((u) => [u.email, u]));
  const memberRows = await OrgMembership.find({
    organization: org._id,
    user: { $in: existingUsers.map((u) => u._id) },
  }).select('user status role').lean();
  const memberOf = new Map(memberRows.map((m) => [String(m.user), m]));

  // The plan caps how many students an organisation can hold.
  const ent = await entitlementsFor(org._id);
  const newMembers = list.filter((e) => {
    const user = byEmail.get(e);
    return !user || !memberOf.has(String(user._id));
  }).length;
  if (ent.maxStudents != null) {
    const current = await OrgMembership.countDocuments({ organization: org._id, role: 'student', status: 'active' });
    if (current + newMembers > ent.maxStudents) {
      const error = new AppError(402, 'PLAN_REQUIRED', `Your plan holds up to ${ent.maxStudents} students.`);
      error.details = { feature: 'max_students', limit: ent.maxStudents, current };
      throw error;
    }
  }

  const results = [];
  for (const email of list) {
    const found = byEmail.get(email);
    if (found) {
      const member = memberOf.get(String(found._id));
      if (member) {
        results.push({ email, status: 'already' });
        continue;
      }
      await OrgMembership.create({ organization: org._id, user: found._id, role: 'student', status: 'active', invitedBy: req?.user?._id });
      mail(sendOrgStudentEmail({ org, to: email, signInUrl: orgSiteUrl(org) }));
      results.push({ email, status: 'linked' });
      continue;
    }

    // A new account. Its password is a random value nobody knows; the emailed link is the only way in,
    // so only the owner of the mailbox can ever use it.
    const token = generateToken();
    let user;
    try {
      user = await User.create({
        fullName: nameFromEmail(email),
        email,
        passwordHash: crypto.randomBytes(32).toString('hex'),
        role: 'student',
        isEmailVerified: true,
        memberships: [{ product: 'student', role: 'student' }],
        verificationCode: authService.generateVerificationCode(),
        passwordResetTokenHash: hashToken(token),
        passwordResetExpires: new Date(Date.now() + SETUP_TTL_MS),
      });
      await OrgMembership.create({ organization: org._id, user: user._id, role: 'student', status: 'active', invitedBy: req?.user?._id });
    } catch (error) {
      if (user) await user.deleteOne().catch(() => {});
      if (error?.code === 11000) {
        results.push({ email, status: 'already' });
        continue;
      }
      throw error;
    }
    mail(sendOrgStudentEmail({ org, to: email, setupUrl: `${orgSiteUrl(org)}/set-password?token=${encodeURIComponent(token)}` }));
    results.push({ email, status: 'added' });
  }

  await recordAction({
    actorId: req?.user?._id, action: 'ORG_STUDENTS_ADD', targetId: org._id, targetType: 'Organization',
    metadata: { added: results.filter((r) => r.status === 'added').length, linked: results.filter((r) => r.status === 'linked').length }, req,
  });
  return results;
};
