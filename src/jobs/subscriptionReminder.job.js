import { runJob } from './runner.js';
import { processSubscriptionExpiryReminders } from '../services/studentPlan.service.js';

/**
 * Sweeps student entitlements for passes expiring within the next 24 hours
 * and sends an expiry warning email + notification.
 */
export const runSubscriptionReminderJob = async (now = new Date()) => {
  return runJob(
    'subscription-expiry-reminder',
    async (ctx) => {
      const processed = await processSubscriptionExpiryReminders(now);
      ctx.count('reminders_sent', processed.length);
    },
    { lockTtlMs: 5 * 60 * 1000 },
  );
};
