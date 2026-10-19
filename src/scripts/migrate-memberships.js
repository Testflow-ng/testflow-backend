/**
 * Create product memberships from existing roles (centralized identity).
 *   node src/scripts/migrate-memberships.js --dry-run   # report only, writes nothing
 *   node src/scripts/migrate-memberships.js             # apply
 *
 * Idempotent: users that already have memberships are left alone; re-running
 * changes nothing. Rules:
 *   role student    -> membership student
 *   role advertiser -> membership ads, and role becomes 'student' (global level)
 *   AdvertiserProfile exists for a user -> also an ads membership, but ONLY when that
 *      account's email is verified (never link on an unverified email)
 *   admin / super_admin -> no product memberships (admin roles stay global)
 * Accounts are never merged here: email is already unique across all products.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { AdvertiserProfile } from '../models/AdvertiserProfile.js';

export const planMembership = (user, hasAdsProfile) => {
  if ((user.memberships ?? []).length) return { action: 'skip', reason: 'already migrated' };
  const memberships = [];
  const set = {};
  if (user.role === 'student') memberships.push({ product: 'student', role: 'student', joinedAt: user.createdAt ?? new Date() });
  if (user.role === 'advertiser') {
    memberships.push({ product: 'ads', role: 'advertiser', joinedAt: user.createdAt ?? new Date() });
    set.role = 'student';
  }
  let review = null;
  if (hasAdsProfile && !memberships.some((m) => m.product === 'ads')) {
    if (user.isEmailVerified) memberships.push({ product: 'ads', role: 'advertiser', joinedAt: new Date() });
    else review = 'has an ads profile but the email is not verified; ads access not linked';
  }
  if (!memberships.length) {
    return review ? { action: 'review', reason: review } : { action: 'skip', reason: `no product for role "${user.role}"` };
  }
  return { action: 'migrate', memberships, set, review };
};

export const runMigration = async ({ dryRun }) => {
  const adsUsers = new Set((await AdvertiserProfile.find().select('user').lean()).map((p) => String(p.user)));
  const stats = { scanned: 0, migrated: 0, skipped: 0, needsReview: 0, byProduct: { student: 0, ads: 0 } };
  const review = [];
  for await (const user of User.find().select('role memberships isEmailVerified createdAt email').lean().cursor()) {
    stats.scanned += 1;
    const plan = planMembership(user, adsUsers.has(String(user._id)));
    if (plan.action === 'skip') { stats.skipped += 1; continue; }
    if (plan.action === 'review') { stats.needsReview += 1; review.push({ id: String(user._id), reason: plan.reason }); continue; }
    if (plan.review) { stats.needsReview += 1; review.push({ id: String(user._id), reason: plan.review }); }
    plan.memberships.forEach((m) => { stats.byProduct[m.product] += 1; });
    stats.migrated += 1;
    if (!dryRun) {
      // Guarded write: only touches accounts that still have no memberships (safe to run concurrently / repeatedly).
      await User.updateOne({ _id: user._id, 'memberships.0': { $exists: false } }, { $set: { memberships: plan.memberships, ...plan.set } });
    }
  }
  return { dryRun, ...stats, review };
};

if (process.argv[1]?.endsWith('migrate-memberships.js')) {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();
  const result = await runMigration({ dryRun });
  console.log(JSON.stringify(result, null, 2));
  console.log(dryRun ? '\nDRY RUN: nothing was written.' : '\nMigration applied.');
  await disconnectDB();
  await mongoose.disconnect();
}
