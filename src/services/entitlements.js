import { Subscription } from '../models/Subscription.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { AppError } from '../utils/AppError.js';

/**
 * Return the entitlements that an org currently has, based on its active
 * subscription and the plan definition stored in PlanDefinition.
 * If the org has no subscription, returns a minimal set (no ads, no limits).
 */
export async function entitlementsFor(orgId) {
  const sub = await Subscription.findOne({
    organization: orgId,
    status: 'active',
  })
    .populate('planKey')
    .lean();
  if (!sub) {
    return { adsEnabled: false, maxStudents: null, maxActiveExams: null, maxExamsPerMonth: null, customDomain: false, storageMb: null, communityEnabled: false };
  }
  const planKey = sub.planKey;
  const planDef = await PlanDefinition.findOne({ key: planKey }).lean();
  if (!planDef) {
    throw new AppError(400, 'PLAN_UNAVAILABLE', `Plan "${planKey}" is not defined.`);
  }
  const base = planDef.entitlements ?? {};
  return {
    adsEnabled: sub.status === 'active' || sub.status === 'past_due' ? base.adsEnabled ?? false : false,
    maxStudents: base.maxStudents,
    maxActiveExams: base.maxActiveExams,
    maxExamsPerMonth: base.maxExamsPerMonth,
    customDomain: base.customDomain,
    storageMb: base.storageMb,
    communityEnabled: base.communityEnabled,
  };
}

export default entitlementsFor;