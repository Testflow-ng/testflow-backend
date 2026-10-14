import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { Campaign } from '../../models/Campaign.js';
import { AdServe } from '../../models/AdServe.js';
import { AdEvent } from '../../models/AdEvent.js';
import { AdViewer } from '../../models/AdViewer.js';
import { AdDailyStat } from '../../models/AdDailyStat.js';
import { ExamSession } from '../../models/ExamSession.js';
import { PostUtmeSession } from '../../models/PostUtmeSession.js';
import { AppError } from '../../utils/AppError.js';
import { rank, RANKER_VERSION } from '../../utils/ads/ranker.js';
import { whatsappHref } from '../../utils/ads/content.js';
import { STATUS } from '../../utils/ads/campaignState.js';
import { extractSessionFeatures } from '../../utils/ads/features.js';
import { getSettings } from './settings.service.js';
import { logDecision, recordOutcome } from './decisionLog.service.js';
import { notPurged } from './campaign.service.js';

const HOUR = 60 * 60 * 1000;
const secret = () => config.ADS_EVENT_SECRET ?? `${config.JWT_ACCESS_SECRET}:ads-events`;
/** Keyed hash: stable per input, irreversible without the server secret. */
const hmac = (...parts) => crypto.createHmac('sha256', secret()).update(parts.join('|')).digest('hex');
export const studentKeyOf = (userId) => hmac('student', userId);
const today = () => new Date().toISOString().slice(0, 10);

const noAd = (reason) => ({ ad: null, reason, ranker: RANKER_VERSION });

const adPayload = (campaign, serveId) => ({
  serveId,
  label: 'Sponsored',
  title: campaign.title,
  description: campaign.description,
  imageUrl: campaign.image?.url ?? null,
  cta: campaign.destination.type === 'whatsapp'
    ? { type: 'whatsapp', label: 'Chat on WhatsApp', href: whatsappHref(campaign.destination.whatsapp) }
    : { type: 'url', label: 'Learn more', href: campaign.destination.url },
});

const bump = async (campaignId, field, extra = {}) => {
  await Promise.all([
    Campaign.updateOne({ _id: campaignId }, { $inc: { [`stats.${field}`]: 1, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`stats.${k}`, v])) } }),
    AdDailyStat.updateOne({ campaign: campaignId, day: today() }, { $inc: { [field]: 1, ...extra } }, { upsert: true }),
  ]);
};

/**
 * Returns the ranker `context` (unchanged shape) plus a plain `session` summary
 * used ONLY for bucketed feature extraction (see utils/ads/features.js).
 */
const loadContext = async (user, { sessionType, sessionId }) => {
  const answeredOf = (qs) => (qs ?? []).filter((q) => q.selectedOption != null).length;
  if (sessionType === 'exam') {
    const s = await ExamSession.findOne({ _id: sessionId, student: user._id })
      .select('status subjectCode subject totalQuestions correctCount timeTakenSeconds durationMinutes strikes questions.selectedOption')
      .populate('subject', 'title department');
    if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    if (s.status !== 'submitted') throw new AppError(409, 'SESSION_NOT_COMPLETED', 'Complete the session before requesting an ad.');
    const department = s.subject?.department ?? user.department;
    return {
      context: { subjects: [s.subject?.title], subjectCodes: [s.subjectCode], department },
      session: {
        sessionType, subjectCodes: [s.subjectCode], department, level: user.level ?? null, correct: s.correctCount,
        totalQuestions: s.totalQuestions, answered: answeredOf(s.questions), timeTakenSeconds: s.timeTakenSeconds,
        durationMinutes: s.durationMinutes, strikes: s.strikes, streakCount: user.streakCount,
      },
    };
  }
  const s = await PostUtmeSession.findOne({ _id: sessionId, student: user._id })
    .select('status subjectCodes totalQuestions totalScore timeTakenSeconds durationMinutes strikes questions.selectedOption');
  if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  if (s.status !== 'submitted') throw new AppError(409, 'SESSION_NOT_COMPLETED', 'Complete the session before requesting an ad.');
  const department = user.utmeData?.departmentChoice;
  return {
    context: { subjects: [], subjectCodes: s.subjectCodes, department },
    session: {
      sessionType, subjectCodes: s.subjectCodes, department, level: 'post-utme', correct: s.totalScore,
      totalQuestions: s.totalQuestions, answered: answeredOf(s.questions), timeTakenSeconds: s.timeTakenSeconds,
      durationMinutes: s.durationMinutes, strikes: s.strikes, streakCount: user.streakCount,
    },
  };
};

/** Serve-time eligibility: enforced here regardless of whether the lifecycle worker has run. */
export const eligibleCampaignFilter = (now = new Date()) => ({
  status: { $in: [STATUS.ACTIVE, STATUS.SCHEDULED] },
  paymentStatus: 'paid',
  startsAt: { $lte: now },
  endsAt: { $gt: now },
  ...notPurged(now),
});

export const serveAd = async (user, input) => {
  const settings = await getSettings();
  if (!settings.adsEnabled) return noAd('ads_disabled');
  const { context, session } = await loadContext(user, input);
  const studentKey = studentKeyOf(String(user._id));
  const sessionKey = hmac('session', input.sessionType, input.sessionId);
  const now = new Date();

  // Idempotent per session: reload / retry returns the same ad.
  const prior = await AdServe.findOne({ sessionKey });
  if (prior) {
    if (prior.studentKey !== studentKey) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    const c = await Campaign.findOne({ _id: prior.campaign, ...eligibleCampaignFilter(now) }).populate('image', 'url');
    return c ? { ad: adPayload(c, prior.serveId), ranker: prior.ranker } : noAd('no_eligible_campaign');
  }

  const recent = await AdServe.find({ studentKey, createdAt: { $gte: new Date(now - 24 * HOUR) } }).select('campaign').lean();
  const sessionFeatures = extractSessionFeatures(session, { now, adsSeenToday: recent.length });
  const logNoAd = (reason) => logDecision({ now, rankerVersion: RANKER_VERSION, outcome: 'no_ad', noAdReason: reason, session: sessionFeatures }, settings);
  if (recent.length >= settings.maxAdsPerStudentPerDay) {
    await logNoAd('frequency_capped');
    return noAd('frequency_capped');
  }
  const seen = {};
  for (const r of recent) seen[r.campaign] = (seen[r.campaign] ?? 0) + 1;
  const blocked = Object.entries(seen).filter(([, n]) => n >= settings.maxSameCampaignPerStudentPerDay).map(([id]) => id);

  const candidates = await Campaign.find({ ...eligibleCampaignFilter(now), _id: { $nin: blocked } })
    .select('title description keywords destination endsAt image').populate('image', 'url').limit(200).lean();
  if (!candidates.length) {
    await logNoAd('no_eligible_campaign');
    return noAd('no_eligible_campaign');
  }

  const todayStats = await AdDailyStat.find({ day: today(), campaign: { $in: candidates.map((c) => c._id) } }).select('campaign impressions').lean();
  const byId = new Map(todayStats.map((s) => [String(s.campaign), s.impressions]));
  const impressionsToday = (c) => byId.get(String(c._id)) ?? 0;
  const ranked = rank(candidates, context, { impressionsToday });
  const [best] = ranked;

  const serveId = crypto.randomUUID();
  try {
    await AdServe.create({ serveId, campaign: best.campaign._id, studentKey, sessionKey, ranker: RANKER_VERSION });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    return serveAd(user, input); // lost a race for this session → return the winner's ad
  }
  await bump(best.campaign._id, 'eligibleRequests');
  await logDecision({ now, serveId, rankerVersion: RANKER_VERSION, outcome: 'served', session: sessionFeatures, ranked, impressionsToday }, settings);
  return { ad: adPayload(best.campaign, serveId), ranker: RANKER_VERSION };
};

const FIELD = { impression: 'impressions', click: 'clicks', whatsapp_click: 'whatsappClicks', skip: 'skips' };
const MAX_AGE = { impression: 2 * HOUR, click: 24 * HOUR, whatsapp_click: 24 * HOUR, skip: 24 * HOUR };

/**
 * Record an engagement event. Deduplicated by `eventId` (idempotency key) and by
 * (serveId, type). Counters are only bumped for the insert that wins.
 */
export const recordEvent = async (user, { serveId, eventId, type, visibleMs }) => {
  const serve = await AdServe.findOne({ serveId });
  if (!serve || serve.studentKey !== studentKeyOf(String(user._id))) {
    throw new AppError(404, 'SERVE_NOT_FOUND', 'Ad not found or no longer valid.');
  }
  if (Date.now() - serve.createdAt > MAX_AGE[type]) throw new AppError(410, 'SERVE_EXPIRED', 'This ad event is too old to record.');
  if (type === 'impression' && (visibleMs ?? 0) < 1000) {
    throw new AppError(422, 'IMPRESSION_CRITERIA_NOT_MET', 'An impression requires the ad to be visible for at least 1 second.');
  }
  const campaign = await Campaign.findById(serve.campaign).select('destination').lean();
  if (!campaign) throw new AppError(404, 'SERVE_NOT_FOUND', 'Ad not found or no longer valid.');
  if (type === 'whatsapp_click' && campaign.destination.type !== 'whatsapp') {
    throw new AppError(422, 'INVALID_EVENT', 'This ad has no WhatsApp contact.');
  }
  if (type === 'click' || type === 'whatsapp_click') {
    const seenImpression = await AdEvent.exists({ serveId, type: 'impression' });
    if (!seenImpression) throw new AppError(409, 'IMPRESSION_REQUIRED', 'Record the impression before a click.');
  }

  const redirectUrl = campaign.destination.type === 'whatsapp' ? whatsappHref(campaign.destination.whatsapp) : campaign.destination.url;
  try {
    await AdEvent.create({ eventId, serveId, campaign: serve.campaign, type });
  } catch (e) {
    if (e?.code === 11000) return { accepted: false, duplicate: true, redirectUrl };
    throw e;
  }
  await bump(serve.campaign, FIELD[type]);
  await recordOutcome(serveId, type, visibleMs);
  if (type === 'impression') {
    try {
      await AdViewer.create({ campaign: serve.campaign, viewerHash: hmac('viewer', user._id, serve.campaign) });
      await bump(serve.campaign, 'uniqueViewers');
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  return { accepted: true, duplicate: false, redirectUrl };
};
