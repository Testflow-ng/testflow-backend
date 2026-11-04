import { StudentPurchase } from '../models/StudentPurchase.js';
import { ExamSession } from '../models/ExamSession.js';
import { PostUtmeSession } from '../models/PostUtmeSession.js';
import { RateLimitHit } from '../models/RateLimitHit.js';
import { AuthCode } from '../models/AuthCode.js';
import { JobRun } from '../models/JobRun.js';
import { DeviceToken } from '../models/DeviceToken.js';
import { Campaign } from '../models/Campaign.js';
import { logger } from '../utils/logger.js';
import { recordAction } from './audit.service.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const RETENTION_POLICIES = Object.freeze({
  abandonedCheckoutTimeoutMinutes: 15,
  abandonedCheckoutRetentionDays: 30,
  inProgressSessionTimeoutHours: 24,
  abandonedSessionRetentionDays: 30,
  rateLimitRetentionHours: 24,
  authCodeRetentionHours: 24,
  jobRunRetentionDays: 30,
  inactiveDeviceTokenRetentionDays: 90,
  adCampaignPostExpiryRetentionDays: 7,
});

let lastRetentionSweepResult = null;

/**
 * Runs a comprehensive data retention sweep across all TestFlow entities.
 */
export const runSystemRetentionSweep = async (now = new Date(), actorId = null) => {
  const result = {
    startedAt: now,
    studentPurchasesAbandoned: 0,
    studentPurchasesPurged: 0,
    examSessionsAbandoned: 0,
    examSessionsPurged: 0,
    postUtmeSessionsAbandoned: 0,
    postUtmeSessionsPurged: 0,
    rateLimitsPurged: 0,
    authCodesPurged: 0,
    jobRunsPurged: 0,
    deviceTokensPurged: 0,
    completedAt: null,
  };

  try {
    // 1. Student Purchases: Mark pending sessions older than 15 mins as abandoned
    const timeoutThreshold = new Date(now.getTime() - RETENTION_POLICIES.abandonedCheckoutTimeoutMinutes * MINUTE_MS);
    const abandonRes = await StudentPurchase.updateMany(
      { status: 'initialized', createdAt: { $lte: timeoutThreshold } },
      { $set: { status: 'abandoned' } }
    );
    result.studentPurchasesAbandoned = abandonRes.modifiedCount || 0;

    // Purge abandoned checkouts older than 30 days
    const stalePurchaseThreshold = new Date(now.getTime() - RETENTION_POLICIES.abandonedCheckoutRetentionDays * DAY_MS);
    const purgePurchasesRes = await StudentPurchase.deleteMany({
      status: 'abandoned',
      createdAt: { $lte: stalePurchaseThreshold },
    });
    result.studentPurchasesPurged = purgePurchasesRes.deletedCount || 0;

    // 2. Exam Sessions: Mark in-progress sessions expired > 24 hours ago as abandoned
    const sessionExpiredThreshold = new Date(now.getTime() - RETENTION_POLICIES.inProgressSessionTimeoutHours * HOUR_MS);
    const abandonExamRes = await ExamSession.updateMany(
      { status: 'in_progress', expiresAt: { $lte: sessionExpiredThreshold } },
      { $set: { status: 'abandoned' } }
    );
    result.examSessionsAbandoned = abandonExamRes.modifiedCount || 0;

    // Purge abandoned exam sessions older than 30 days
    const staleSessionThreshold = new Date(now.getTime() - RETENTION_POLICIES.abandonedSessionRetentionDays * DAY_MS);
    const purgeExamRes = await ExamSession.deleteMany({
      status: 'abandoned',
      createdAt: { $lte: staleSessionThreshold },
    });
    result.examSessionsPurged = purgeExamRes.deletedCount || 0;

    // Same for Post-UTME Sessions
    const abandonPostUtmeRes = await PostUtmeSession.updateMany(
      { status: 'in_progress', expiresAt: { $lte: sessionExpiredThreshold } },
      { $set: { status: 'abandoned' } }
    );
    result.postUtmeSessionsAbandoned = abandonPostUtmeRes.modifiedCount || 0;

    const purgePostUtmeRes = await PostUtmeSession.deleteMany({
      status: 'abandoned',
      createdAt: { $lte: staleSessionThreshold },
    });
    result.postUtmeSessionsPurged = purgePostUtmeRes.deletedCount || 0;

    // 3. Rate Limit Hits: Delete expired rate limit records
    const rateLimitsRes = await RateLimitHit.deleteMany({
      expireAt: { $lte: now },
    });
    result.rateLimitsPurged = rateLimitsRes.deletedCount || 0;

    // 4. Auth Codes: Delete codes expired > 24h ago
    const authCodeThreshold = new Date(now.getTime() - RETENTION_POLICIES.authCodeRetentionHours * HOUR_MS);
    const authCodesRes = await AuthCode.deleteMany({
      expireAt: { $lte: authCodeThreshold },
    });
    result.authCodesPurged = authCodesRes.deletedCount || 0;

    // 5. Job Runs: Delete job run records older than 30 days
    const jobRunThreshold = new Date(now.getTime() - RETENTION_POLICIES.jobRunRetentionDays * DAY_MS);
    const jobRunsRes = await JobRun.deleteMany({
      startedAt: { $lte: jobRunThreshold },
    });
    result.jobRunsPurged = jobRunsRes.deletedCount || 0;

    // 6. Device Tokens: Delete inactive push tokens not updated in 90 days
    const tokenThreshold = new Date(now.getTime() - RETENTION_POLICIES.inactiveDeviceTokenRetentionDays * DAY_MS);
    const tokensRes = await DeviceToken.deleteMany({
      $or: [
        { active: false, updatedAt: { $lte: tokenThreshold } },
        { updatedAt: { $lte: tokenThreshold } },
      ],
    });
    result.deviceTokensPurged = tokensRes.deletedCount || 0;

    result.completedAt = new Date();
    lastRetentionSweepResult = result;

    logger.info(
      `[data-retention] Retention sweep completed: abandoned ${result.studentPurchasesAbandoned} checkouts, ${result.examSessionsAbandoned} exams; purged ${result.studentPurchasesPurged} stale checkouts, ${result.examSessionsPurged} stale exams, ${result.rateLimitsPurged} rate limits, ${result.jobRunsPurged} job logs.`
    );

    if (actorId) {
      await recordAction({
        actorId,
        action: 'DATA_RETENTION_SWEEP_EXECUTED',
        metadata: result,
      });
    }

    return result;
  } catch (err) {
    logger.error('[data-retention] Error during retention sweep:', err);
    throw err;
  }
};

/**
 * Returns current counts, policies, and the last sweep summary.
 */
export const getRetentionOverview = async () => {
  const [
    totalPurchases,
    pendingPurchases,
    abandonedPurchases,
    totalExamSessions,
    inProgressExamSessions,
    abandonedExamSessions,
    totalJobRuns,
    totalDeviceTokens,
    totalCampaigns,
  ] = await Promise.all([
    StudentPurchase.countDocuments(),
    StudentPurchase.countDocuments({ status: 'initialized' }),
    StudentPurchase.countDocuments({ status: 'abandoned' }),
    ExamSession.countDocuments(),
    ExamSession.countDocuments({ status: 'in_progress' }),
    ExamSession.countDocuments({ status: 'abandoned' }),
    JobRun.countDocuments(),
    DeviceToken.countDocuments(),
    Campaign.countDocuments(),
  ]);

  return {
    policies: RETENTION_POLICIES,
    lastSweep: lastRetentionSweepResult,
    metrics: {
      studentPurchases: {
        total: totalPurchases,
        pending: pendingPurchases,
        abandoned: abandonedPurchases,
      },
      examSessions: {
        total: totalExamSessions,
        inProgress: inProgressExamSessions,
        abandoned: abandonedExamSessions,
      },
      jobRuns: totalJobRuns,
      deviceTokens: totalDeviceTokens,
      campaigns: totalCampaigns,
    },
  };
};
