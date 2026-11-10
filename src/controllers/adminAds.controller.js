import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { Campaign } from '../models/Campaign.js';
import { JobRun } from '../models/JobRun.js';
import { notFound } from '../utils/ads/errors.js';
import * as mod from '../services/ads/moderation.service.js';
import * as analytics from '../services/ads/analytics.service.js';
import * as settingsSvc from '../services/ads/settings.service.js';
import * as payments from '../services/ads/payment.service.js';
import * as decisionLog from '../services/ads/decisionLog.service.js';
import * as houseAds from '../services/ads/houseAds.service.js';
import { recordAction } from '../services/audit.service.js';

export const list = asyncHandler(async (req, res) => res.json(await mod.listForAdmin(req.query)));
export const inspect = asyncHandler(async (req, res) => res.json(await mod.inspect(req.params.id)));
export const history = asyncHandler(async (req, res) => res.json({ history: await mod.history(req.params.id) }));
export const approve = asyncHandler(async (req, res) => res.json({ campaign: await mod.approve(req.params.id, req) }));
export const reject = asyncHandler(async (req, res) => res.json({ campaign: await mod.reject(req.params.id, req.body, req) }));
export const suspend = asyncHandler(async (req, res) => res.json({ campaign: await mod.suspend(req.params.id, req.body, req) }));
export const reinstate = asyncHandler(async (req, res) => res.json({ campaign: await mod.reinstate(req.params.id, req) }));
export const remove = asyncHandler(async (req, res) => res.json({ campaign: await mod.remove(req.params.id, req.body, req) }));

export const campaignAnalytics = asyncHandler(async (req, res) => {
  const c = await Campaign.findById(req.params.id);
  if (!c) throw notFound('Campaign');
  res.json(await analytics.campaignAnalytics(c, req.query));
});
export const overview = asyncHandler(async (_req, res) => res.json(await analytics.adminOverview()));
export const getSettings = asyncHandler(async (_req, res) => res.json({ settings: await settingsSvc.getSettings() }));
export const updateSettings = asyncHandler(async (req, res) => res.json({ settings: await settingsSvc.updateSettings(req.body, req) }));

export const listPayments = asyncHandler(async (req, res) => {
  const { page, limit, ...filter } = req.query;
  res.json(await payments.listPayments(filter, { page, limit }));
});

export const refund = asyncHandler(async (req, res) => res.json({ payment: await payments.refundPayment(req.params.id, req.body, req) }));

export const jobRuns = asyncHandler(async (_req, res) => {
  res.json({ runs: await JobRun.find().sort({ startedAt: -1 }).limit(50).lean() });
});

export const trainingSummary = asyncHandler(async (_req, res) => res.json(await decisionLog.trainingSummary()));

/** Streams newline-delimited JSON (one anonymized decision per line). Super-admin only. */
export const trainingExport = asyncHandler(async (req, res) => {
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="ad-training.jsonl"', 'Cache-Control': 'no-store' });
  const count = await decisionLog.streamTrainingRecords(req.query, async (rec) => {
    if (!res.write(`${JSON.stringify(rec)}\n`)) await new Promise((r) => res.once('drain', r));
  });
  await recordAction({ actorId: req.user._id, action: 'AD_TRAINING_EXPORT', metadata: { count, ...req.query }, req });
  res.end();
});

// ---------- House Ads ----------
export const listHouseAds = asyncHandler(async (_req, res) => {
  res.json({ houseAds: await houseAds.listHouseAds() });
});

export const createHouseAd = asyncHandler(async (req, res) => {
  const ad = await houseAds.createHouseAd(req.user, req.body);
  await recordAction({ actorId: req.user._id, action: 'HOUSE_AD_CREATED', targetId: ad._id, targetType: 'Campaign', req });
  res.status(201).json({ houseAd: ad });
});

export const updateHouseAd = asyncHandler(async (req, res) => {
  const ad = await houseAds.updateHouseAd(req.params.id, req.body, req.user);
  await recordAction({ actorId: req.user._id, action: 'HOUSE_AD_UPDATED', targetId: ad._id, targetType: 'Campaign', req });
  res.json({ houseAd: ad });
});

export const deleteHouseAd = asyncHandler(async (req, res) => {
  const result = await houseAds.deleteHouseAd(req.params.id, req.user, req.body?.reason);
  await recordAction({ actorId: req.user._id, action: 'HOUSE_AD_DELETED', targetId: req.params.id, targetType: 'Campaign', req });
  res.json(result);
});

export const uploadHouseAdImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(422, 'VALIDATION_ERROR', 'Attach an image in the file field.');
  const { uploadAdAsset } = await import('../services/ads/image.service.js');
  const { getSettings } = await import('../services/ads/settings.service.js');
  const settings = await getSettings();
  const asset = await uploadAdAsset(req.user, req.file.buffer, settings);
  res.status(201).json({ asset: { id: String(asset._id), url: asset.url } });
});
