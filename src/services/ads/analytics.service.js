import { Campaign } from '../../models/Campaign.js';
import { AdDailyStat } from '../../models/AdDailyStat.js';
import { AdPayment } from '../../models/AdPayment.js';
import { validationError } from '../../utils/ads/errors.js';

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0); // percent, 2 dp

const dayKey = (d) => d.toISOString().slice(0, 10);

/**
 * Metric definitions (also in docs/ads/IMPLEMENTATION.md):
 *  eligibleRequests – times the ad was selected & returned to a student after a CBT session
 *  impressions      – client-reported renders: ≥50% visible for ≥1s, one per served ad (deduped)
 *  uniqueViewers    – distinct students (HMAC per campaign) with ≥1 impression
 *  clicks           – first "view/open ad" click per served ad
 *  whatsappClicks   – first WhatsApp-contact tap per served ad
 *  ctr / whatsappCtr – clicks / impressions, whatsappClicks / impressions (percent)
 *  spendKobo        – campaign price if payment is verified, else 0
 */
export const campaignAnalytics = async (campaign, { from, to } = {}) => {
  const end = to ?? new Date();
  const start = from ?? campaign.startsAt ?? campaign.createdAt;
  if (end - start > 92 * 24 * 60 * 60 * 1000) throw validationError({ from: 'Date range cannot exceed 92 days.' });
  const series = await AdDailyStat.find({ campaign: campaign._id, day: { $gte: dayKey(start), $lte: dayKey(end) } })
    .sort({ day: 1 }).select('-_id -campaign').lean();
  const s = campaign.stats ?? {};
  return {
    campaignId: String(campaign._id),
    status: campaign.status,
    startsAt: campaign.startsAt ?? null,
    endsAt: campaign.endsAt ?? null,
    expiredAt: campaign.expiredAt ?? null,
    spend: { amountKobo: campaign.paymentStatus === 'paid' ? campaign.priceKobo : 0, currency: campaign.currency },
    totals: {
      eligibleRequests: s.eligibleRequests ?? 0,
      impressions: s.impressions ?? 0,
      uniqueViewers: s.uniqueViewers ?? 0,
      clicks: s.clicks ?? 0,
      whatsappClicks: s.whatsappClicks ?? 0,
      skips: s.skips ?? 0,
      ctr: ratio(s.clicks ?? 0, s.impressions ?? 0),
      whatsappCtr: ratio(s.whatsappClicks ?? 0, s.impressions ?? 0),
    },
    daily: series,
  };
};

export const adminOverview = async () => {
  const since = dayKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [byStatus, revenue, perf] = await Promise.all([
    Campaign.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    AdPayment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, amountKobo: { $sum: '$amountKobo' }, payments: { $sum: 1 } } },
    ]),
    AdDailyStat.aggregate([
      { $match: { day: { $gte: since } } },
      { $group: { _id: null, impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, whatsappClicks: { $sum: '$whatsappClicks' } } },
    ]),
  ]);
  return {
    campaignsByStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
    revenue: { amountKobo: revenue[0]?.amountKobo ?? 0, payments: revenue[0]?.payments ?? 0, currency: 'NGN' },
    last30Days: { impressions: perf[0]?.impressions ?? 0, clicks: perf[0]?.clicks ?? 0, whatsappClicks: perf[0]?.whatsappClicks ?? 0 },
  };
};
