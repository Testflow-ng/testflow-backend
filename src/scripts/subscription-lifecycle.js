import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { Subscription } from '../models/Subscription.js';
import { recordAction } from '../services/audit.service.js';
import { applyScheduledDowngrades, enforcePlanForOrgs } from '../services/orgSubscription.service.js';

const GRACE_DAYS = 7;

export const runSubscriptionLifecycle = async () => {
  const now = new Date();

  // 0. Scheduled downgrades take effect first, before any lapse handling, so a subscription that
  //    waited for its period end to drop a plan is never mistaken for an unpaid one. Its exams are
  //    unpublished (not deleted) below.
  const downgradedOrgs = await applyScheduledDowngrades(now);

  // 1. Move active → past_due if currentPeriodEnd has passed. Because entitlements only count an
  //    `active` subscription, the organisation effectively falls back to Free here.
  const lapsing = await Subscription.find(
    { status: 'active', planKey: { $ne: 'free' }, currentPeriodEnd: { $lt: now } },
    { organization: 1 },
  ).lean();
  const pastDueResult = await Subscription.updateMany(
    { status: 'active', planKey: { $ne: 'free' }, currentPeriodEnd: { $lt: now } },
    {
      status: 'past_due',
      graceEndsAt: new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000),
    },
  );
  if (pastDueResult.modifiedCount > 0) {
    await recordAction({
      actorId: 'system', action: 'SUBSCRIPTION_EXPIRE', targetType: 'Organization',
      metadata: { expiredCount: pastDueResult.modifiedCount },
    });
  }

  // 2. Move past_due → expired if grace period ended
  const expiredResult = await Subscription.updateMany(
    { status: 'past_due', graceEndsAt: { $lt: now } },
    { status: 'expired' },
  );
  if (expiredResult.modifiedCount > 0) {
    await recordAction({
      actorId: 'system', action: 'SUBSCRIPTION_LIFECYCLE', targetType: 'Organization',
      metadata: { fromPastDueToExpired: expiredResult.modifiedCount },
    });
  }

  // 3. Clean up abandoned initialized subscriptions older than 30 days
  const staleResult = await Subscription.deleteMany({
    status: 'initialized',
    createdAt: { $lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
  });
  if (staleResult.deletedCount > 0) {
    await recordAction({
      actorId: 'system', action: 'SUBSCRIPTION_CLEANUP', targetType: 'Organization',
      metadata: { deletedStale: staleResult.deletedCount },
    });
  }

  // 4. Unpublish the live and paid exams a downgraded plan no longer allows, and tell the owners.
  const touched = [...downgradedOrgs, ...lapsing.map((sub) => sub.organization)];
  const enforced = await enforcePlanForOrgs(touched);

  console.log(
    `Lifecycle: downgrades=${downgradedOrgs.length}, active→past_due=${pastDueResult.modifiedCount}, ` +
      `past_due→expired=${expiredResult.modifiedCount}, stale_init_delete=${staleResult.deletedCount}, ` +
      `orgs_enforced=${enforced.orgs}, live_unpublished=${enforced.liveUnpublished}, paid_unpublished=${enforced.paidUnpublished}`,
  );
  return enforced;
};

export default runSubscriptionLifecycle;

// Run only when invoked directly; importing this module must never connect or write.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  await connectDB();
  await runSubscriptionLifecycle();
  await disconnectDB();
};
