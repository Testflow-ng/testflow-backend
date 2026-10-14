import { Subscription } from '../models/Subscription.js';
import { recordAction } from '../services/audit.service.js';

const GRACE_DAYS = 7;

export const runSubscriptionLifecycle = async () => {
  const now = new Date();

  // 1. Move active → past_due if currentPeriodEnd has passed
  const pastDueResult = await Subscription.updateMany(
    { status: 'active', currentPeriodEnd: { $lt: now } },
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

  console.log(`Lifecycle: active→past_due=${pastDueResult.modifiedCount}, past_due→expired=${expiredResult.modifiedCount}, stale_init_delete=${staleResult.deletedCount}`);
};

export default runSubscriptionLifecycle;