import { Subscription } from '../models/Subscription.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { AppError } from '../utils/AppError.js';
import { PLAN_ENTITLEMENTS, PLAN_KEYS, planEntitlements } from '../config/planFeatures.js';

/**
 * The plan an organisation is on, and what that plan allows.
 *
 * Every organisation always has a subscription. New ones are created on Free, and an organisation
 * that predates the Free plan is backfilled the first time anything asks. That keeps the console
 * from having to branch on "no subscription" everywhere, and it means a paid feature can be
 * refused with one clear rule instead of a pile of null checks.
 */

const freeSnapshot = () => ({
  priceMinor: 0,
  currency: 'NGN',
  entitlements: { ...PLAN_ENTITLEMENTS.free },
});

/** Idempotently give an organisation its Free subscription. */
export async function ensureFreeSubscription(orgId) {
  const existing = await Subscription.findOne({ organization: orgId, planKey: 'free' }).sort({ createdAt: -1 });
  if (existing) {
    if (existing.status !== 'active' || existing.currentPeriodEnd) {
      existing.status = 'active';
      existing.currentPeriodEnd = null;
      existing.planSnapshot = freeSnapshot();
      await existing.save();
    }
    return existing.toObject();
  }
  const created = await Subscription.create({
    organization: orgId,
    planKey: 'free',
    status: 'active',
    currentPeriodEnd: null,
    planSnapshot: freeSnapshot(),
    provider: 'none',
  });
  return created.toObject();
}

/**
 * Return the entitlements that an org currently has, based on its active subscription and the
 * plan definition stored in PlanDefinition. The config defaults fill in any field a plan row
 * predates, so an older database still gets an answer for the newer features.
 *
 * `past_due` (grace period) keeps the paid plan's entitlements. `expired`/terminal states fall
 * back to Free entitlements for feature gating while the workspace remains readable.
 */
export async function entitlementsFor(orgId) {
  const now = new Date();
  const sub =
    (await Subscription.findOne({ organization: orgId, status: 'active' }).sort({ createdAt: -1 }).lean()) ??
    (await Subscription.findOne({ organization: orgId, status: 'past_due', graceEndsAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .lean()) ??
    (await ensureFreeSubscription(orgId));
  const planKey = PLAN_KEYS.includes(sub.planKey) ? sub.planKey : 'free';
  const effectivePlanKey = sub.status === 'expired' || sub.status === 'cancelled' ? 'free' : planKey;
  const planDef = await PlanDefinition.findOne({ key: effectivePlanKey }).lean();

  // Defaults, then what was purchased, then the live plan row: a corrected plan definition wins
  // over a stale snapshot, while a deleted plan row still leaves the snapshot usable.
  const merged = {
    ...planEntitlements(effectivePlanKey),
    ...(effectivePlanKey === planKey ? sub.planSnapshot?.entitlements ?? {} : {}),
    ...(planDef?.entitlements ?? {}),
  };

  return {
    planKey: effectivePlanKey,
    subscriptionStatus: sub.status ?? 'active',
    adsEnabled: Boolean(merged.adsEnabled),
    maxExams: merged.maxExams ?? null,
    questionBanks: Boolean(merged.questionBanks),
    announcements: Boolean(merged.announcements),
    reports: Boolean(merged.reports),
    paidExams: Boolean(merged.paidExams),
    liveCbt: Boolean(merged.liveCbt),
    maxStudents: merged.maxStudents ?? null,
    maxActiveExams: merged.maxActiveExams ?? null,
    maxExamsPerMonth: merged.maxExamsPerMonth ?? null,
    customDomain: Boolean(merged.customDomain),
    storageMb: merged.storageMb ?? null,
    maxImages: merged.maxImages ?? null,
    communityEnabled: Boolean(merged.communityEnabled),
  };
}

/** The plan a feature needs, for a 402's `details`. */
const requiredPlanFor = (feature) =>
  feature === 'paid_exams' || feature === 'live_cbt' ? 'studio' : 'pro';

const FEATURE_KEY_MAP = Object.freeze({
  paid_exams: 'paidExams',
  live_cbt: 'liveCbt',
  question_banks: 'questionBanks',
  announcements: 'announcements',
  reports: 'reports',
  custom_domain: 'customDomain',
  community_enabled: 'communityEnabled',
});

/**
 * Refuse a console action the organisation's plan does not include.
 *
 * The frontend hides and dims these, but the rule has to live here too: a direct call must not
 * reach a feature the plan never bought.
 */
export async function requireFeature(orgId, feature, message) {
  const ent = await entitlementsFor(orgId);
  const key = FEATURE_KEY_MAP[feature] ?? feature;
  if (ent[key] || ent[feature]) return ent;
  const requiredPlan = requiredPlanFor(feature);
  const error = new AppError(
    402,
    'PLAN_REQUIRED',
    message ?? `This feature is part of the ${requiredPlan === 'studio' ? 'Studio' : 'Pro'} plan.`,
  );
  error.details = { feature, requiredPlan };
  throw error;
}

/**
 * True when the org can perform subscription-gated mutations (create/publish/sell/start new attempts).
 * Active or `past_due` within grace is writable; expired/cancelled/none falls to read-only for paid features.
 */
export async function subscriptionWritable(orgId) {
  const sub = await Subscription.findOne({
    organization: orgId,
    status: { $in: ['active', 'past_due'] },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!sub) return false;
  if (sub.status === 'active') return true;
  if (sub.status === 'past_due') return sub.graceEndsAt && new Date(sub.graceEndsAt).getTime() > Date.now();
  return false;
}

export async function requireWritableSubscription(orgId) {
  if (await subscriptionWritable(orgId)) return;
  // Free/default workspaces with no paid lifecycle still operate under Free plan rules; block only
  // expired paid states from mutations that could create new chargeable/work obligations.
  const latest = await Subscription.findOne({ organization: orgId, planKey: { $ne: 'free' } })
    .sort({ createdAt: -1 })
    .lean();
  if (!latest) return; // never had paid subscription
  if (latest.status === 'expired' || (latest.status === 'past_due' && !(latest.graceEndsAt && new Date(latest.graceEndsAt).getTime() > Date.now()))) {
    const err = new AppError(402, 'SUBSCRIPTION_EXPIRED', 'Your subscription has expired. Renew to continue making changes; you can still view and export your data.');
    err.details = { subscriptionStatus: latest.status };
    throw err;
  }
}

export default entitlementsFor;
