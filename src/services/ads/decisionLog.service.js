import crypto from 'node:crypto';
import { AdDecision } from '../../models/AdDecision.js';
import { buildDecisionRecord, toExportRecord } from '../../utils/ads/features.js';
import { campaignKeyOf } from '../../utils/ads/pseudonym.js';
import { logger } from '../../utils/logger.js';
import { getSettings } from './settings.service.js';

/**
 * Best-effort: a logging failure must NEVER break ad serving. Returns the
 * decisionId, or null when logging is disabled / failed.
 */
export const logDecision = async (input, settings) => {
  try {
    const s = settings ?? (await getSettings());
    if (!s.trainingLoggingEnabled) return null;
    const decisionId = crypto.randomUUID();
    await AdDecision.create(buildDecisionRecord({
      ...input, decisionId, keyOf: campaignKeyOf, retentionDays: s.trainingRetentionDays,
    }));
    return decisionId;
  } catch (e) {
    logger.error('Ad decision log failed', e.message);
    return null;
  }
};

/** Attach an accepted engagement event to its decision. Idempotent ($set only). */
export const recordOutcome = async (serveId, type, visibleMs) => {
  try {
    const set = {
      impression: { 'label.impression': true, 'label.visibleMs': Math.min(Math.max(visibleMs ?? 0, 0), 600000) },
      click: { 'label.click': true },
      whatsapp_click: { 'label.whatsappClick': true },
      skip: { 'label.skip': true },
    }[type];
    if (set) await AdDecision.updateOne({ serveId }, { $set: set });
  } catch (e) {
    logger.error('Ad outcome log failed', e.message);
  }
};

/** Stream export records through `write(obj)`; returns how many were written. */
export const streamTrainingRecords = async ({ from, to, includeNoAd = true, limit = 50000 }, write) => {
  const filter = {};
  if (from || to) filter.ts = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (!includeNoAd) filter.outcome = 'served';
  let n = 0;
  const cursor = AdDecision.find(filter).sort({ ts: 1 }).limit(limit).lean().cursor();
  for await (const doc of cursor) {
    await write(toExportRecord(doc));
    n += 1;
  }
  return n;
};

export const trainingSummary = async () => {
  const [byOutcome, labels, range, byDay, settings] = await Promise.all([
    AdDecision.aggregate([{ $group: { _id: { outcome: '$outcome', reason: '$noAdReason' }, n: { $sum: 1 } } }]),
    AdDecision.aggregate([
      { $match: { outcome: 'served' } },
      { $group: {
        _id: null, served: { $sum: 1 },
        impressions: { $sum: { $cond: ['$label.impression', 1, 0] } }, clicks: { $sum: { $cond: ['$label.click', 1, 0] } },
        whatsappClicks: { $sum: { $cond: ['$label.whatsappClick', 1, 0] } }, skips: { $sum: { $cond: ['$label.skip', 1, 0] } },
      } },
    ]),
    AdDecision.aggregate([{ $group: { _id: null, oldest: { $min: '$ts' }, newest: { $max: '$ts' }, total: { $sum: 1 } } }]),
    AdDecision.aggregate([{ $group: { _id: '$day', n: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 30 }]),
    getSettings(),
  ]);
  const l = labels[0] ?? { served: 0, impressions: 0, clicks: 0, whatsappClicks: 0, skips: 0 };
  return {
    totalRecords: range[0]?.total ?? 0,
    oldest: range[0]?.oldest ?? null,
    newest: range[0]?.newest ?? null,
    outcomes: byOutcome.map((r) => ({ outcome: r._id.outcome, reason: r._id.reason ?? null, count: r.n })),
    labels: { served: l.served, impressions: l.impressions, clicks: l.clicks, whatsappClicks: l.whatsappClicks, skips: l.skips },
    perDay: byDay.map((d) => ({ day: d._id, records: d.n })).reverse(),
    loggingEnabled: settings.trainingLoggingEnabled,
    retentionDays: settings.trainingRetentionDays,
  };
};

/** Honors a shortened retention setting immediately (the TTL index is only a safety net). */
export const sweepTrainingRecords = async (now = new Date()) => {
  const { trainingRetentionDays } = await getSettings();
  const res = await AdDecision.deleteMany({ ts: { $lt: new Date(now.getTime() - trainingRetentionDays * 86_400_000) } });
  return res.deletedCount ?? 0;
};
