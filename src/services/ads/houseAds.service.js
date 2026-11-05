import crypto from 'node:crypto';
import { User } from '../../models/User.js';
import { Campaign } from '../../models/Campaign.js';
import { AdAsset } from '../../models/AdAsset.js';
import { CampaignModeration } from '../../models/CampaignModeration.js';
import { AppError } from '../../utils/AppError.js';
import { STATUS } from '../../utils/ads/campaignState.js';
import { notPurged } from './campaign.service.js';
import { whatsappHref } from '../../utils/ads/content.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ensures a valid AdAsset reference for the house ad.
 * Supports passing an existing assetId or providing an image URL directly.
 */
const resolveHouseAsset = async (adminUser, { assetId, imageUrl }) => {
  if (assetId) {
    const asset = await AdAsset.findById(assetId);
    if (asset) {
      asset.attachedAt = new Date();
      await asset.save();
      return asset;
    }
  }

  const url = imageUrl?.trim() || '/photos/hero-student.webp';
  const sha256 = crypto.createHash('sha256').update(url).digest('hex');

  let asset = await AdAsset.findOne({ sha256, storageKey: { $regex: /^house-ad/ } });
  if (!asset) {
    asset = await AdAsset.create({
      owner: adminUser._id,
      storageKey: `house-ad/${sha256.slice(0, 16)}`,
      url,
      width: 1200,
      height: 630,
      bytes: 0,
      format: 'webp',
      sha256,
      attachedAt: new Date(),
    });
  } else {
    asset.attachedAt = new Date();
    await asset.save();
  }
  return asset;
};

export const createHouseAd = async (adminUser, data) => {
  if (!data.title?.trim()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Ad headline/title is required.');
  }
  if (!data.description?.trim()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Ad description is required.');
  }

  const asset = await resolveHouseAsset(adminUser, data);
  const now = new Date();
  const durationDays = Number(data.durationDays) > 0 ? Number(data.durationDays) : 365;
  const startsAt = data.preferredStartDate && new Date(data.preferredStartDate) > now
    ? new Date(data.preferredStartDate)
    : now;
  const endsAt = new Date(startsAt.getTime() + durationDays * DAY_MS);

  let destination = data.destination;
  if (!destination || (!destination.url && !destination.whatsapp)) {
    destination = { type: 'url', url: data.destinationUrl || '/billing' };
  }

  const campaign = await Campaign.create({
    advertiser: adminUser._id,
    name: (data.name || data.title).trim().slice(0, 120),
    title: data.title.trim(),
    description: data.description.trim(),
    image: asset._id,
    destination: {
      type: destination.type === 'whatsapp' ? 'whatsapp' : 'url',
      url: destination.url || undefined,
      whatsapp: destination.whatsapp || undefined,
    },
    keywords: Array.isArray(data.keywords) ? data.keywords.slice(0, 3) : [],
    placements: Array.isArray(data.placements) && data.placements.length > 0 ? data.placements : ['all'],
    durationDays,
    dailyFeeKobo: 0,
    priceKobo: 0,
    status: STATUS.ACTIVE,
    paymentStatus: 'exempt',
    isHouseAd: true,
    startsAt,
    endsAt,
    submittedAt: now,
    approvedAt: now,
  });

  await CampaignModeration.create({
    campaign: campaign._id,
    actor: adminUser._id,
    actorRole: adminUser.role || 'admin',
    action: 'approved',
    toStatus: STATUS.ACTIVE,
    reason: 'Admin House Ad published',
  });

  return Campaign.findById(campaign._id).populate('image', 'url').populate('advertiser', 'fullName email');
};

export const listHouseAds = async () => {
  return Campaign.find({ isHouseAd: true, ...notPurged() })
    .sort({ createdAt: -1 })
    .populate('image', 'url')
    .populate('advertiser', 'fullName email')
    .lean();
};

export const updateHouseAd = async (id, data, adminUser) => {
  const campaign = await Campaign.findOne({ _id: id, isHouseAd: true });
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'House ad not found.');

  if (data.title) campaign.title = data.title.trim();
  if (data.name) campaign.name = data.name.trim();
  if (data.description) campaign.description = data.description.trim();
  if (data.keywords) campaign.keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 3) : [];
  if (data.placements) campaign.placements = Array.isArray(data.placements) && data.placements.length > 0 ? data.placements : ['all'];
  if (data.destination) campaign.destination = data.destination;

  if (data.imageUrl || data.assetId) {
    const asset = await resolveHouseAsset(adminUser, data);
    campaign.image = asset._id;
  }

  if (data.status && [STATUS.ACTIVE, STATUS.SUSPENDED, STATUS.ARCHIVED].includes(data.status)) {
    campaign.status = data.status;
  }

  if (data.durationDays && Number(data.durationDays) > 0) {
    campaign.durationDays = Number(data.durationDays);
    const start = campaign.startsAt || new Date();
    campaign.endsAt = new Date(start.getTime() + campaign.durationDays * DAY_MS);
  }

  await campaign.save();
  return Campaign.findById(campaign._id).populate('image', 'url').populate('advertiser', 'fullName email');
};

export const deleteHouseAd = async (id, adminUser, reason = 'Deleted by admin') => {
  const campaign = await Campaign.findOne({ _id: id, isHouseAd: true });
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'House ad not found.');

  const now = new Date();
  campaign.status = STATUS.REMOVED;
  campaign.removedAt = now;
  campaign.suspensionReason = reason;
  campaign.purgeAt = new Date(now.getTime() + 7 * DAY_MS);
  await campaign.save();

  await CampaignModeration.create({
    campaign: campaign._id,
    actor: adminUser._id,
    actorRole: adminUser.role || 'admin',
    action: 'removed',
    toStatus: STATUS.REMOVED,
    reason,
  });

  return { success: true };
};

/**
 * Public or authenticated fetch for an active house ad payload.
 * Rotates randomly across all currently active house ads matching the requested placement.
 */
export const getActiveHouseAdPayload = async (placement = null) => {
  const now = new Date();
  const filter = {
    isHouseAd: true,
    status: STATUS.ACTIVE,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
    ...notPurged(now),
  };

  if (placement) {
    filter.$or = [
      { placements: { $exists: false } },
      { placements: { $size: 0 } },
      { placements: 'all' },
      { placements: placement },
    ];
  }

  const count = await Campaign.countDocuments(filter);
  if (!count) return null;

  const randomSkip = Math.floor(Math.random() * count);
  const c = await Campaign.findOne(filter).skip(randomSkip).populate('image', 'url').lean();

  if (!c) return null;

  // Bump eligible request count asynchronously
  Campaign.updateOne({ _id: c._id }, { $inc: { 'stats.impressions': 1, 'stats.eligibleRequests': 1 } }).catch(() => {});

  return {
    serveId: crypto.randomUUID(),
    label: 'Sponsored',
    title: c.title,
    description: c.description,
    imageUrl: c.image?.url ?? null,
    cta: c.destination?.type === 'whatsapp'
      ? { type: 'whatsapp', label: 'Chat on WhatsApp', href: whatsappHref(c.destination.whatsapp) }
      : { type: 'url', label: 'Get TestFlow Plus', href: c.destination?.url || '/billing' },
  };
};
