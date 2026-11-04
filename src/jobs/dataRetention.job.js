import { runJob } from './runner.js';
import { runSystemRetentionSweep } from '../services/dataRetention.service.js';

/**
 * Scheduled background job to clean up abandoned sessions, stale checkouts,
 * expired auth codes, and aged telemetry/job logs.
 */
export const runDataRetentionJob = async (now = new Date()) => {
  return runJob(
    'system-data-retention',
    async (ctx) => {
      const result = await runSystemRetentionSweep(now);
      ctx.count('purchases_abandoned', result.studentPurchasesAbandoned);
      ctx.count('purchases_purged', result.studentPurchasesPurged);
      ctx.count('exams_abandoned', result.examSessionsAbandoned);
      ctx.count('exams_purged', result.examSessionsPurged);
      ctx.count('rate_limits_purged', result.rateLimitsPurged);
      ctx.count('job_runs_purged', result.jobRunsPurged);
    },
    { lockTtlMs: 15 * 60 * 1000 },
  );
};
