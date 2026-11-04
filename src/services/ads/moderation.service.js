import { Campaign } from '../../models/Campaign.js';
import { CampaignModeration } from '../../models/CampaignModeration.js';
import { AdPayment } from '../../models/AdPayment.js';
import { User } from '../../models/User.js';
import { AdvertiserProfile } from '../../models/AdvertiserProfile.js';
import { AppError } from '../../utils/AppError.js';
import { notFound } from '../../utils/ads/errors.js';
import { STATUS } from '../../utils/ads/campaignState.js';
import { recordAction } from '../audit.service.js';
import { getSettings } from './settings.service.js';
import { transition, notPurged, STATUS_GROUPS } from './campaign.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ctx = (req) => ({ actor: req.user._id, actorRole: req.user.role });
const conflict = () => new AppError(409, 'INVALID_TRANSITION', 'The campaign is not in a state that allows this action.');

/** Start/end of the paid period, computed from the approval instant. */
export const computeSchedule = (now, preferredStartDate, durationDays) => {
  const startsAt = preferredStartDate && preferredStartDate > now ? new Date(preferredStartDate) : new Date(now);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationDays * DAY_MS) };
};

export const listForAdmin = async ({ status, group, paymentStatus, advertiser, q, page, limit }) => {
  const filter = { ...notPurged() };
  if (group) filter.status = { $in: STATUS_GROUPS[group] };
  else if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (advertiser) filter.advertiser = advertiser;
  if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const oldestFirst = status === STATUS.PENDING_REVIEW || group === 'pending_review';
  const [items, total] = await Promise.all([
    Campaign.find(filter).sort(oldestFirst ? { submittedAt: 1 } : { createdAt: -1 })
      .skip((page - 1) * limit).limit(limit).populate('image', 'url').populate('advertiser', 'fullName email'),
    Campaign.countDocuments(filter),
  ]);
  return { items, page, limit, total };
};

export const inspect = async (id) => {
  const c = await Campaign.findOne({ _id: id, ...notPurged() }).populate('image', 'url width height bytes');
  if (!c) throw notFound('Campaign');
  const [advertiser, profile, payment, history] = await Promise.all([
    User.findById(c.advertiser).select('fullName email createdAt'),
    AdvertiserProfile.findOne({ user: c.advertiser }),
    c.payment ? AdPayment.findById(c.payment) : null,
    CampaignModeration.find({ campaign: c._id }).sort({ createdAt: 1 }).populate('actor', 'fullName role').lean(),
  ]);
  return { campaign: c, advertiser, profile, payment, history };
};

export const history = async (id) => CampaignModeration.find({ campaign: id }).sort({ createdAt: 1 }).populate('actor', 'fullName role').lean();

export const approve = async (id, req) => {
  const c = await Campaign.findOne({ _id: id, status: STATUS.PENDING_REVIEW, paymentStatus: 'paid' });
  if (!c) throw conflict(); // unpaid campaigns can never be approved
  const now = new Date();
  const { startsAt, endsAt } = computeSchedule(now, c.preferredStartDate, c.durationDays);
  const doc = await transition({
    id, from: STATUS.PENDING_REVIEW, to: startsAt <= now ? STATUS.ACTIVE : STATUS.SCHEDULED, ...ctx(req), action: 'approved',
    set: { approvedAt: now, startsAt, endsAt }, extraFilter: { paymentStatus: 'paid' },
  });
  if (!doc) throw conflict();
  await recordAction({ actorId: req.user._id, action: 'AD_APPROVE', targetId: doc._id, targetType: 'Campaign', metadata: { startsAt, endsAt }, req });
  return doc;
};

export const reject = async (id, { reason, refund }, req) => {
  const settings = await getSettings();
  const now = new Date();
  // Rejected campaigns are never kept forever: a refund case follows the normal 7-day window,
  // otherwise the advertiser gets `rejectedRetentionDays` to fix and resubmit.
  const set = {
    rejectedAt: now, rejectionReason: reason,
    purgeAt: new Date(now.getTime() + (refund ? settings.retentionDays : settings.rejectedRetentionDays) * DAY_MS),
  };
  if (refund) set.paymentStatus = 'refund_due';
  const doc = await transition({ id, from: STATUS.PENDING_REVIEW, to: STATUS.REJECTED, ...ctx(req), action: 'rejected', reason, set });
  if (!doc) throw conflict();
  await recordAction({ actorId: req.user._id, action: 'AD_REJECT', targetId: doc._id, targetType: 'Campaign', metadata: { reason, refund: !!refund }, req });
  return doc;
};

export const suspend = async (id, { reason }, req) => {
  const doc = await transition({
    id, from: [STATUS.ACTIVE, STATUS.SCHEDULED], to: STATUS.SUSPENDED, ...ctx(req), action: 'suspended', reason,
    set: { suspendedAt: new Date(), suspensionReason: reason },
  });
  if (!doc) throw conflict();
  await recordAction({ actorId: req.user._id, action: 'AD_SUSPEND', targetId: doc._id, targetType: 'Campaign', metadata: { reason }, req });
  return doc;
};

/** Suspension does NOT extend the paid period; if it already ended, the worker expires it. */
export const reinstate = async (id, req) => {
  const c = await Campaign.findOne({ _id: id, status: STATUS.SUSPENDED });
  if (!c) throw conflict();
  const now = new Date();
  if (c.endsAt <= now) throw new AppError(409, 'CAMPAIGN_ENDED', 'The paid period has already ended; this campaign will be expired.');
  const doc = await transition({
    id, from: STATUS.SUSPENDED, to: c.startsAt <= now ? STATUS.ACTIVE : STATUS.SCHEDULED, ...ctx(req), action: 'reinstated',
    unset: { suspendedAt: 1, suspensionReason: 1 },
  });
  if (!doc) throw conflict();
  await recordAction({ actorId: req.user._id, action: 'AD_REINSTATE', targetId: doc._id, targetType: 'Campaign', req });
  return doc;
};

export const remove = async (id, { reason }, req) => {
  const settings = await getSettings();
  const now = new Date();
  const doc = await transition({
    id, from: [STATUS.ACTIVE, STATUS.SCHEDULED, STATUS.SUSPENDED], to: STATUS.REMOVED, ...ctx(req), action: 'removed', reason,
    set: { removedAt: now, purgeAt: new Date(now.getTime() + settings.retentionDays * DAY_MS), suspensionReason: reason },
  });
  if (!doc) throw conflict();
  await recordAction({ actorId: req.user._id, action: 'AD_REMOVE', targetId: doc._id, targetType: 'Campaign', metadata: { reason }, req });
  return doc;
};
