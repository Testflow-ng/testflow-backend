import { StudentEntitlement, ENTITLEMENT_KEYS, isEntitlementLive } from '../models/StudentEntitlement.js';
import { StudentPurchase } from '../models/StudentPurchase.js';
import { STUDENT_PLANS, findStudentPlan, adFreePlans, toPlanView } from '../config/plans.js';

/**
 * Student plans and the entitlements they grant. This is the student counterpart to
 * `services/entitlements.js` (which answers the same question for an Everybody organization).
 *
 * Everything here reads or writes `StudentEntitlement`; nothing in this module knows about
 * advertising, and the advertising eligibility service reads it like any other caller.
 */

export { STUDENT_PLANS, findStudentPlan };

export const listStudentPlans = () => STUDENT_PLANS.filter((p) => p.available).map(toPlanView);

export const listAdFreePlans = () => adFreePlans().map(toPlanView);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows for one student. Small by construction (one per key), so a single indexed read is enough. */
const liveRows = async (userId, now = new Date()) => {
  const rows = await StudentEntitlement.find({ user: userId }).lean();
  return rows.filter((row) => isEntitlementLive(row, now));
};

/**
 * What this student holds right now. `status` is deliberately coarse:
 *   active   — at least one entitlement is live
 *   free     — nothing live and nothing expired (never bought, or an admin revoked)
 *   expired  — held something that has since lapsed
 */
export const studentEntitlements = async (userId, { now = new Date() } = {}) => {
  const [rows, anyRows, latestPurchase] = await Promise.all([
    liveRows(userId, now),
    StudentEntitlement.countDocuments({ user: userId }),
    StudentPurchase.findOne({ user: userId, status: 'paid' }).sort({ paidAt: -1 }).lean(),
  ]);

  const entitlements = {};
  for (const key of ENTITLEMENT_KEYS) entitlements[key] = false;

  let expiresAt = null;
  let planKey = null;
  for (const row of rows) {
    entitlements[row.key] = true;
    if (row.planKey) planKey = row.planKey;
    const rowExpiry = row.expiresAt ? new Date(row.expiresAt) : null;
    if (rowExpiry && (!expiresAt || rowExpiry.getTime() > expiresAt.getTime())) expiresAt = rowExpiry;
  }

  const status = rows.length ? 'active' : anyRows ? 'expired' : 'free';

  return {
    userId: String(userId),
    status,
    planKey,
    entitlements,
    adFree: entitlements.ad_free === true,
    liveCbtHost: entitlements.live_cbt_host === true,
    activeKeys: rows.map((row) => row.key).sort(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    // Last verified payment, so the UI can show "paid on" without a second call.
    lastPaidAt: latestPurchase?.paidAt ? new Date(latestPurchase.paidAt).toISOString() : null,
    verifiedAt: now.toISOString(),
  };
};

/** Cheap single-key read for gates that run on a hot path (live CBT creation). */
export const hasEntitlement = async (userId, key) => {
  if (!ENTITLEMENT_KEYS.includes(key)) return false;
  const row = await StudentEntitlement.findOne({ user: userId, key }).lean();
  return isEntitlementLive(row);
};

/**
 * Grant, or extend an existing grant. `expiresAt` is a wall-clock instant: an expired-but-present
 * row is irrelevant, so a renewal extends from whichever is later, now or the current expiry, which
 * makes a mid-pass renewal stack rather than reset.
 */
export const grantEntitlement = async ({
  userId, key, source, planKey = null, purchaseId = null, durationDays = null, grantedBy = null, now = new Date(),
}) => {
  if (!ENTITLEMENT_KEYS.includes(key)) throw new Error(`Unknown entitlement key: ${key}`);

  const existing = await StudentEntitlement.findOne({ user: userId, key }).lean();
  const base = isEntitlementLive(existing, now) && existing.expiresAt ? new Date(existing.expiresAt) : now;
  const expiresAt = durationDays ? new Date(base.getTime() + durationDays * DAY_MS) : null;

  return StudentEntitlement.findOneAndUpdate(
    { user: userId, key },
    {
      $set: {
        active: true,
        source,
        planKey,
        purchase: purchaseId,
        grantedBy,
        startsAt: existing && isEntitlementLive(existing, now) ? existing.startsAt : now,
        expiresAt,
        revokedAt: null,
        revokedReason: null,
      },
    },
    { upsert: true, new: true },
  );
};

/** Revocation keeps the row (history) and clears liveness. Used by refunds and chargebacks. */
export const revokeEntitlement = async ({ userId, key, reason, now = new Date() }) => {
  if (!ENTITLEMENT_KEYS.includes(key)) throw new Error(`Unknown entitlement key: ${key}`);
  return StudentEntitlement.findOneAndUpdate(
    { user: userId, key },
    { $set: { active: false, revokedAt: now, revokedReason: reason ?? 'revoked' } },
    { new: true },
  );
};

/**
 * Maintenance sweep: mark lapsed rows inactive. Purely cosmetic (liveness never consults `active`),
 * so it is safe to run at any cadence and safe to never run.
 */
export const expireLapsedEntitlements = async ({ now = new Date() } = {}) => {
  const res = await StudentEntitlement.updateMany(
    { active: true, revokedAt: null, expiresAt: { $ne: null, $lte: now } },
    { $set: { active: false } },
  );
  return res.modifiedCount ?? 0;
};
