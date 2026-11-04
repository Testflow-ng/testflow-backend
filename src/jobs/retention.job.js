import { Campaign } from '../models/Campaign.js';
import { CampaignModeration } from '../models/CampaignModeration.js';
import { AdEvent } from '../models/AdEvent.js';
import { AdViewer } from '../models/AdViewer.js';
import { AdServe } from '../models/AdServe.js';
import { AdDailyStat } from '../models/AdDailyStat.js';
import { AdAsset } from '../models/AdAsset.js';
import { AdPayment } from '../models/AdPayment.js';
import { recordAction } from '../services/audit.service.js';
import { deleteStoredImage } from '../services/ads/image.service.js';
import { sweepTrainingRecords } from '../services/ads/decisionLog.service.js';
import { runJob, withRetry } from './runner.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;
const STALE_UNATTACHED_MS = DAY_MS;
const UNPAID_CHECKOUT_RETENTION_MS = 30 * DAY_MS;

/**
 * Purge ONE campaign. Safe ordering (every step idempotent, so a crash/retry
 * at any point is harmless; the campaign row is deleted LAST and stays hidden
 * from dashboards meanwhile because every read filters on purgeAt):
 *   1 claim → 2 events/viewers/serves/daily-stats/history → 3 anonymize payment
 *   line items (financial rows are KEPT) → 4 delete image if unreferenced →
 *   5 delete campaign → 6 audit entry (id only).
 */
export const purgeCampaign = async (campaign) => {
  const id = campaign._id;
  await Campaign.updateOne({ _id: id }, { $set: { purgeStartedAt: new Date() } });

  await AdEvent.deleteMany({ campaign: id });
  await AdViewer.deleteMany({ campaign: id });
  await AdServe.deleteMany({ campaign: id });
  await AdDailyStat.deleteMany({ campaign: id });
  await CampaignModeration.deleteMany({ campaign: id });

  // Keep amounts/refs/timestamps (tax & fraud records); drop the campaign's content.
  await AdPayment.updateMany(
    { 'items.campaign': id },
    { $set: { 'items.$[i].campaignPurgedAt': new Date() }, $unset: { 'items.$[i].campaignName': '' } },
    { arrayFilters: [{ 'i.campaign': id }] },
  );

  const stillUsed = await Campaign.exists({ image: campaign.image, _id: { $ne: id } });
  if (!stillUsed) {
    const asset = await AdAsset.findById(campaign.image);
    if (asset) {
      await withRetry(() => deleteStoredImage(asset.storageKey));
      await AdAsset.deleteOne({ _id: asset._id });
    }
  }

  await Campaign.deleteOne({ _id: id });
  await recordAction({ action: 'AD_CAMPAIGN_PURGED', targetId: id, targetType: 'Campaign', metadata: { reason: 'retention', status: campaign.status } });
};

export const runPurge = async (ctx, now = new Date()) => {
  const due = await Campaign.find({ purgeAt: { $lte: now } }).limit(BATCH);
  for (const c of due) {
    try {
      await withRetry(() => purgeCampaign(c));
      ctx.count('campaignsPurged');
    } catch (e) {
      ctx.fail(`campaign ${c._id}: ${e.message}`); // left in place; retried next run
    }
  }
};

/** Images uploaded but never attached to a campaign within 24h. */
export const sweepOrphanAssets = async (ctx, now = new Date()) => {
  const orphans = await AdAsset.find({ attachedAt: null, createdAt: { $lte: new Date(now - STALE_UNATTACHED_MS) } }).limit(BATCH);
  for (const a of orphans) {
    try {
      await withRetry(() => deleteStoredImage(a.storageKey));
      await AdAsset.deleteOne({ _id: a._id });
      ctx.count('orphanAssetsDeleted');
    } catch (e) {
      ctx.fail(`asset ${a._id}: ${e.message}`);
    }
  }
  // Assets whose campaign was deleted (e.g. a deleted draft) and that nothing references.
  const detached = await AdAsset.find({ attachedAt: { $ne: null, $lte: new Date(now - STALE_UNATTACHED_MS) } }).limit(BATCH);
  for (const a of detached) {
    if (await Campaign.exists({ image: a._id })) continue;
    try {
      await withRetry(() => deleteStoredImage(a.storageKey));
      await AdAsset.deleteOne({ _id: a._id });
      ctx.count('unreferencedAssetsDeleted');
    } catch (e) {
      ctx.fail(`asset ${a._id}: ${e.message}`);
    }
  }
};

/** Checkouts that never reached the provider or were abandoned unpaid carry no financial obligation. */
export const sweepUnpaidCheckouts = async (ctx, now = new Date()) => {
  const res = await AdPayment.deleteMany({ $or: [{ status: 'abandoned' }, { failureReason: 'PROVIDER_INITIALIZE_FAILED' }], createdAt: { $lte: new Date(now - UNPAID_CHECKOUT_RETENTION_MS) } });
  if (res.deletedCount) ctx.count('unpaidCheckoutsDeleted', res.deletedCount);
};

/** Anonymized training records follow their OWN retention (AdSettings.trainingRetentionDays). */
export const sweepTraining = async (ctx) => {
  const n = await sweepTrainingRecords();
  if (n) ctx.count('trainingRecordsDeleted', n);
};

export const runRetention = () =>
  runJob('ads-retention', async (ctx) => {
    for (const step of [runPurge, sweepOrphanAssets, sweepUnpaidCheckouts, sweepTraining]) {
      try { await step(ctx); } catch (e) { ctx.fail(`${step.name}: ${e.message}`); }
    }
  }, { lockTtlMs: 30 * 60 * 1000 });
