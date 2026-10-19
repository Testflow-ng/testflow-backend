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
 */
export async function entitlementsFor(orgId) {
  const active = await Subscription.findOne({ organization: orgId, status: 'active' })
    .sort({ createdAt: -1 })
    .lean();
  const sub = active ?? (await ensureFreeSubscription(orgId));
  const planKey = PLAN_KEYS.includes(sub.planKey) ? sub.planKey : 'free';
  const planDef = await PlanDefinition.findOne({ key: planKey }).lean();

  // Defaults, then what was purchased, then the live plan row: a corrected plan definition wins
  // over a stale snapshot, while a deleted plan row still leaves the snapshot usable.
  const merged = {
    ...planEntitlements(planKey),
    ...(sub.planSnapshot?.entitlements ?? {}),
    ...(planDef?.entitlements ?? {}),
  };

  return {
    planKey,
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

/**
 * Refuse a console action the organisation's plan does not include.
 *
 * The frontend hides and dims these, but the rule has to live here too: a direct call must not
 * reach a feature the plan never bought.
 */
export async function requireFeature(orgId, feature, message) {
  const ent = await entitlementsFor(orgId);
  if (ent[feature]) return ent;
  const requiredPlan = requiredPlanFor(feature);
  const error = new AppError(
    402,
    'PLAN_REQUIRED',
    message ?? `This feature is part of the ${requiredPlan === 'studio' ? 'Studio' : 'Pro'} plan.`,
  );
  error.details = { feature, requiredPlan };
  throw error;
}

export default entitlementsFor;
