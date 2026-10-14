import { z } from 'zod';
import { ALL_STATUSES } from '../utils/ads/campaignState.js';
import { STATUS_GROUPS } from '../services/ads/campaign.service.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(72)
  .regex(/[A-Za-z]/, 'Password must include a letter').regex(/\d/, 'Password must include a number');
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

const destination = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), url: z.string().max(2000) }).strict(),
  z.object({ type: z.literal('whatsapp'), whatsapp: z.string().max(25) }).strict(),
]);

// Limits that depend on admin settings (title length, word count, duration…) are enforced in the service.
const campaignBody = {
  name: z.string().max(200),
  title: z.string().max(500),
  description: z.string().max(20000),
  assetId: objectId,
  destination,
  keywords: z.array(z.string().max(100)).max(5).default([]),
  durationDays: z.number().int(),
  preferredStartDate: z.coerce.date().optional(),
};

export const registerAdvertiserSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120),
    email, password, confirmPassword: z.string(),
    businessName: z.string().trim().min(2).max(120),
    contactPhone: z.string().trim().max(20).optional(),
  }).strict().refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }),
});
export const loginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(72) }).strict() });
export const profileSchema = z.object({
  body: z.object({
    businessName: z.string().trim().min(2).max(120).optional(),
    contactPhone: z.string().trim().max(20).optional(),
    fullName: z.string().trim().min(2).max(120).optional(),
  }).strict(),
});

export const createCampaignSchema = z.object({ body: z.object(campaignBody).strict() });
export const updateCampaignSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object(Object.fromEntries(Object.entries(campaignBody).map(([k, v]) => [k, v.optional()]))).strict(),
});
export const idParam = z.object({ params: z.object({ id: objectId }) });
export const listCampaignsSchema = z.object({
  query: z.object({
    group: z.enum(Object.keys(STATUS_GROUPS)).optional(),
    status: z.enum(ALL_STATUSES).optional(),
    q: z.string().trim().max(100).optional(), page, limit,
  }).strict(),
});
export const analyticsSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict(),
});

export const quoteSchema = z.object({ body: z.object({ campaignIds: z.array(objectId).min(1).max(50) }).strict() });
export const checkoutSchema = z.object({
  body: z.object({
    campaignIds: z.array(objectId).min(1).max(50),
    acceptTerms: z.boolean(),
    termsVersion: z.string().max(40),
  }).strict(),
});
export const verifyPaymentSchema = z.object({ query: z.object({ reference: z.string().min(6).max(100) }).strict() });

// ---- admin ----
export const adminListSchema = z.object({
  query: z.object({
    status: z.enum(ALL_STATUSES).optional(), group: z.enum(Object.keys(STATUS_GROUPS)).optional(),
    paymentStatus: z.enum(['unpaid', 'pending', 'paid', 'refund_due', 'refunded']).optional(),
    advertiser: objectId.optional(), q: z.string().trim().max(100).optional(), page, limit,
  }).strict(),
});
export const reasonSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().min(5, 'Please give a reason (min 5 characters)').max(1000) }).strict(),
});
export const rejectSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().min(5, 'Please give a reason (min 5 characters)').max(1000), refund: z.boolean().default(false) }).strict(),
});
export const adminPaymentsSchema = z.object({
  query: z.object({
    status: z.enum(['initialized', 'paid', 'failed', 'abandoned', 'refunding', 'refunded']).optional(),
    advertiser: objectId.optional(), page, limit,
  }).strict(),
});
export const settingsSchema = z.object({
  body: z.object({
    adsEnabled: z.boolean(),
    dailyFeeKobo: z.number().int().min(0).max(100_000_000),
    pricingPolicy: z.enum(['flat', 'tiered']),
    tiers: z.array(z.object({ minDays: z.number().int().min(2).max(365), percentOff: z.number().int().min(1).max(90) }).strict()).max(10),
    minDurationDays: z.number().int().min(1).max(365),
    maxDurationDays: z.number().int().min(1).max(365),
    maxDescriptionWords: z.number().int().min(1).max(2000),
    maxTitleChars: z.number().int().min(10).max(200),
    maxKeywordChars: z.number().int().min(2).max(60),
    maxCampaignsPerCheckout: z.number().int().min(1).max(50),
    maxActiveCampaignsPerAdvertiser: z.number().int().min(1).max(500),
    imageTargetBytes: z.number().int().min(50_000).max(2 * 1024 * 1024),
    imageMaxBytes: z.number().int().min(100_000).max(2 * 1024 * 1024),
    retentionDays: z.number().int().min(1).max(90),
    rejectedRetentionDays: z.number().int().min(1).max(365),
    maxAdsPerStudentPerDay: z.number().int().min(1).max(20),
    maxSameCampaignPerStudentPerDay: z.number().int().min(1).max(20),
    trainingLoggingEnabled: z.boolean(),
    trainingRetentionDays: z.number().int().min(30).max(1095),
    termsVersion: z.string().trim().min(1).max(40),
    termsUrl: z.string().url().max(500),
    contentRulesUrl: z.string().url().max(500),
    privacyUrl: z.string().url().max(500),
  }).partial().strict().refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one setting' }),
});

export const trainingExportSchema = z.object({
  query: z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(),
    includeNoAd: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(100000).default(50000),
  }).strict(),
});

// ---- student ----
export const serveSchema = z.object({
  body: z.object({ sessionType: z.enum(['exam', 'post_utme']), sessionId: objectId }).strict(),
});
export const eventSchema = z.object({
  body: z.object({
    serveId: z.string().uuid(),
    eventId: z.string().uuid(),
    type: z.enum(['impression', 'click', 'whatsapp_click', 'skip']),
    visibleMs: z.number().int().min(0).max(3_600_000).optional(),
  }).strict(),
});
