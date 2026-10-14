import { Campaign } from '../../models/Campaign.js';
import { CampaignModeration } from '../../models/CampaignModeration.js';
import { AdAsset } from '../../models/AdAsset.js';
import { AppError } from '../../utils/AppError.js';
import { validationError, notFound } from '../../utils/ads/errors.js';
import { computePrice } from '../../utils/ads/pricing.js';
import {
  countWords, parseDestinationUrl, parseWhatsappNumber, normalizeKeywords, plainText,
} from '../../utils/ads/content.js';
import { STATUS, EDITABLE, assertTransition } from '../../utils/ads/campaignState.js';
import { checkDestinationSafety } from '../../utils/ads/urlSafety.js';
import { getSettings } from './settings.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hides campaigns whose retention window has passed, even if the purge job is late. */
export const notPurged = (now = new Date()) => ({ purgeAt: { $not: { $lte: now } } });

/** Dashboard groupings → statuses. */
export const STATUS_GROUPS = {
  active: [STATUS.ACTIVE, STATUS.SCHEDULED],
  pending_review: [STATUS.PENDING_REVIEW],
  pending_payment: [STATUS.PENDING_PAYMENT],
  draft: [STATUS.DRAFT],
  rejected: [STATUS.REJECTED],
  suspended: [STATUS.SUSPENDED],
  expired: [STATUS.EXPIRED, STATUS.REMOVED],
  archived: [STATUS.ARCHIVED],
};

/** Atomic, status-guarded transition + history row. Returns null if the guard failed. */
export const transition = async ({ id, from, to, set = {}, unset = {}, actor, actorRole = 'system', action, reason, extraFilter = {} }) => {
  const froms = Array.isArray(from) ? from : [from];
  froms.forEach((f) => assertTransition(f, to));
  const update = { $set: { status: to, ...set } };
  if (Object.keys(unset).length) update.$unset = unset;
  const doc = await Campaign.findOneAndUpdate({ _id: id, status: { $in: froms }, ...extraFilter }, update, { new: true });
  if (!doc) return null;
  await CampaignModeration.create({
    campaign: doc._id, actor, actorRole, action, fromStatus: froms.length === 1 ? froms[0] : undefined, toStatus: to, reason,
  });
  return doc;
};

const validateContent = (settings, c) => {
  const fields = {};
  const title = plainText(settings.maxTitleChars, 'Title').safeParse(c.title);
  if (!title.success) fields.title = title.error.issues[0].message;
  const name = plainText(120, 'Campaign name').safeParse(c.name);
  if (!name.success) fields.name = name.error.issues[0].message;
  const desc = plainText(20000, 'Description').safeParse(c.description);
  if (!desc.success) fields.description = desc.error.issues[0].message;
  else if (countWords(desc.data) > settings.maxDescriptionWords) {
    fields.description = `Description must be at most ${settings.maxDescriptionWords} words.`;
  }

  const kws = normalizeKeywords(c.keywords ?? []);
  if (kws.length > 3) fields.keywords = 'At most 3 keywords are allowed.';
  else if (kws.some((k) => k.length > settings.maxKeywordChars || !/^[\p{L}\p{N} &+-]+$/u.test(k))) {
    fields.keywords = `Keywords must be letters/numbers, up to ${settings.maxKeywordChars} characters each.`;
  }

  if (!Number.isInteger(c.durationDays) || c.durationDays < settings.minDurationDays || c.durationDays > settings.maxDurationDays) {
    fields.durationDays = `Duration must be between ${settings.minDurationDays} and ${settings.maxDurationDays} days.`;
  }

  let destination;
  if (c.destination?.type === 'url') {
    const r = parseDestinationUrl(c.destination.url ?? '');
    if (!r.ok) fields['destination.url'] = r.message;
    else destination = { type: 'url', url: r.url };
  } else if (c.destination?.type === 'whatsapp') {
    const r = parseWhatsappNumber(c.destination.whatsapp ?? '');
    if (!r.ok) fields['destination.whatsapp'] = r.message;
    else destination = { type: 'whatsapp', whatsapp: r.number };
  } else {
    fields.destination = 'Provide a destination URL or a WhatsApp number.';
  }

  if (c.preferredStartDate) {
    const d = new Date(c.preferredStartDate);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - DAY_MS || d.getTime() > Date.now() + 90 * DAY_MS) {
      fields.preferredStartDate = 'Start date must be within the next 90 days.';
    }
  }
  if (Object.keys(fields).length) throw validationError(fields);

  return {
    name: name.data, title: title.data, description: desc.data, keywords: kws, destination,
    durationDays: c.durationDays,
    preferredStartDate: c.preferredStartDate ? new Date(c.preferredStartDate) : undefined,
  };
};

const assertDestinationSafe = async (destination) => {
  if (destination?.type !== 'url') return;
  const problem = await checkDestinationSafety(destination.url);
  if (problem) throw validationError({ 'destination.url': problem });
};

const attachAsset = async (user, assetId) => {
  const asset = await AdAsset.findOneAndUpdate(
    { _id: assetId, owner: user._id },
    { $set: { attachedAt: new Date() } },
    { new: true },
  );
  if (!asset) throw validationError({ assetId: 'Image not found. Upload the image again.' });
  return asset;
};

const view = (c) => c; // toJSON handles shaping

export const createCampaign = async (user, body) => {
  const settings = await getSettings();
  const content = validateContent(settings, body);
  await assertDestinationSafe(content.destination);
  const activeCount = await Campaign.countDocuments({
    advertiser: user._id, status: { $in: [STATUS.DRAFT, STATUS.PENDING_PAYMENT, STATUS.PENDING_REVIEW, STATUS.ACTIVE, STATUS.SCHEDULED] },
  });
  if (activeCount >= settings.maxActiveCampaignsPerAdvertiser) {
    throw new AppError(409, 'CAMPAIGN_LIMIT', 'You have reached the maximum number of open campaigns.');
  }
  const asset = await attachAsset(user, body.assetId);
  const price = computePrice(settings, content.durationDays);
  const doc = await Campaign.create({
    ...content, advertiser: user._id, image: asset._id, dailyFeeKobo: settings.dailyFeeKobo, priceKobo: price.totalKobo,
  });
  await CampaignModeration.create({ campaign: doc._id, actor: user._id, actorRole: 'advertiser', action: 'created', toStatus: STATUS.DRAFT });
  return view(doc);
};

export const findOwned = async (user, id, projection) => {
  const doc = await Campaign.findOne({ _id: id, advertiser: user._id, ...notPurged() }, projection);
  if (!doc) throw notFound('Campaign');
  return doc;
};

export const updateCampaign = async (user, id, body) => {
  const settings = await getSettings();
  const current = await findOwned(user, id);
  if (!EDITABLE.includes(current.status)) {
    throw new AppError(409, 'NOT_EDITABLE', `A campaign in "${current.status}" cannot be edited.`);
  }
  const paidAlready = current.paymentStatus === 'paid';
  if (paidAlready && body.durationDays !== undefined && body.durationDays !== current.durationDays) {
    throw new AppError(409, 'DURATION_LOCKED', 'The duration of a paid campaign cannot be changed.');
  }
  const base = current.toObject();
  const merged = {
    ...base,
    ...body,
    destination: body.destination ?? base.destination,
    keywords: body.keywords ?? base.keywords,
  };
  const content = validateContent(settings, merged);
  await assertDestinationSafe(content.destination);
  const set = { ...content };
  if (!content.preferredStartDate) set.preferredStartDate = null;
  if (body.assetId && String(body.assetId) !== String(current.image)) {
    set.image = (await attachAsset(user, body.assetId))._id;
  }
  if (!paidAlready) {
    const price = computePrice(settings, content.durationDays);
    set.priceKobo = price.totalKobo;
    set.dailyFeeKobo = settings.dailyFeeKobo;
  }
  const doc = await Campaign.findOneAndUpdate(
    { _id: id, advertiser: user._id, status: { $in: EDITABLE } }, { $set: set }, { new: true, runValidators: true },
  );
  if (!doc) throw new AppError(409, 'NOT_EDITABLE', 'The campaign changed state; reload and try again.');
  return view(doc);
};

/** Only never-paid drafts may be deleted outright. */
export const deleteDraft = async (user, id) => {
  const res = await Campaign.deleteOne({ _id: id, advertiser: user._id, status: STATUS.DRAFT, paymentStatus: 'unpaid' });
  if (!res.deletedCount) {
    await findOwned(user, id); // 404 if not theirs
    throw new AppError(409, 'NOT_DELETABLE', 'Only unpaid drafts can be deleted.');
  }
};

/** Rejected (already paid) → edit → resubmit for review without paying again. */
export const resubmit = async (user, id) => {
  const c = await findOwned(user, id);
  if (c.status !== STATUS.REJECTED) throw new AppError(409, 'INVALID_TRANSITION', 'Only rejected campaigns can be resubmitted.');
  if (c.paymentStatus !== 'paid') {
    throw new AppError(409, 'PAYMENT_REQUIRED', 'This campaign has no valid payment; it cannot be resubmitted.');
  }
  const doc = await transition({
    id, from: STATUS.REJECTED, to: STATUS.PENDING_REVIEW, actor: user._id, actorRole: 'advertiser', action: 'resubmitted',
    set: { submittedAt: new Date() }, unset: { rejectedAt: 1, rejectionReason: 1, purgeAt: 1 }, extraFilter: { advertiser: user._id, paymentStatus: 'paid' },
  });
  if (!doc) throw new AppError(409, 'CONFLICT', 'The campaign changed state; reload and try again.');
  return doc;
};

export const archive = async (user, id) => {
  const c = await findOwned(user, id);
  const doc = await transition({
    id, from: c.status, to: STATUS.ARCHIVED, actor: user._id, actorRole: 'advertiser', action: 'archived',
    set: { archivedAt: new Date(), archivedFrom: c.status }, extraFilter: { advertiser: user._id },
  });
  if (!doc) throw new AppError(409, 'INVALID_TRANSITION', 'This campaign cannot be archived.');
  return doc;
};

/**
 * Republish = a brand-new draft cloned from an expired/removed campaign (the
 * image is shared by reference). It must be paid and approved like any campaign.
 * Idempotent: an open clone already created from the same source is returned.
 */
export const republish = async (user, id) => {
  const src = await findOwned(user, id);
  const was = src.status === STATUS.ARCHIVED ? src.archivedFrom : src.status;
  if (![STATUS.EXPIRED, STATUS.REMOVED].includes(was)) {
    throw new AppError(409, 'NOT_REPUBLISHABLE', 'Only expired or removed campaigns can be republished.');
  }
  const open = await Campaign.findOne({
    advertiser: user._id, republishedFrom: src._id, status: { $in: [STATUS.DRAFT, STATUS.PENDING_PAYMENT] },
  });
  if (open) return open;
  const settings = await getSettings();
  const price = computePrice(settings, Math.min(Math.max(src.durationDays, settings.minDurationDays), settings.maxDurationDays));
  const doc = await Campaign.create({
    advertiser: user._id, name: src.name, title: src.title, description: src.description, image: src.image,
    destination: src.destination, keywords: src.keywords, durationDays: price.days, dailyFeeKobo: settings.dailyFeeKobo,
    priceKobo: price.totalKobo, republishedFrom: src._id,
  });
  await CampaignModeration.create({
    campaign: doc._id, actor: user._id, actorRole: 'advertiser', action: 'republished', toStatus: STATUS.DRAFT, reason: `from ${src._id}`,
  });
  return doc;
};

const withImage = { path: 'image', select: 'url width height' };

export const listCampaigns = async (user, { group, status, q, page, limit }) => {
  const filter = { advertiser: user._id, ...notPurged() };
  if (group) filter.status = { $in: STATUS_GROUPS[group] };
  else if (status) filter.status = status;
  if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (!group && !status) filter.status = { $ne: STATUS.ARCHIVED };
  const [items, total] = await Promise.all([
    Campaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate(withImage),
    Campaign.countDocuments(filter),
  ]);
  return { items, page, limit, total };
};

export const getCampaign = async (user, id) => {
  const c = await findOwned(user, id);
  await c.populate(withImage);
  const history = await CampaignModeration.find({ campaign: c._id }).sort({ createdAt: 1 }).select('-actor').lean();
  const daysLeftMs = c.endsAt ? c.endsAt - Date.now() : null;
  return { campaign: c, history, remainingMs: daysLeftMs != null ? Math.max(0, daysLeftMs) : null };
};

/** Counts per dashboard group (one aggregation). */
export const dashboardSummary = async (user) => {
  const rows = await Campaign.aggregate([
    { $match: { advertiser: user._id, ...notPurged() } },
    { $group: { _id: '$status', n: { $sum: 1 }, impressions: { $sum: '$stats.impressions' }, clicks: { $sum: '$stats.clicks' } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const groups = {};
  for (const [g, statuses] of Object.entries(STATUS_GROUPS)) groups[g] = statuses.reduce((a, s) => a + (byStatus[s] ?? 0), 0);
  return {
    groups,
    totals: { impressions: rows.reduce((a, r) => a + r.impressions, 0), clicks: rows.reduce((a, r) => a + r.clicks, 0) },
  };
};
