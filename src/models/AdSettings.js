import mongoose from 'mongoose';

/** Singleton admin-configurable Ads Manager settings (money in integer kobo). */
const adSettingsSchema = new mongoose.Schema(
  {
    adsEnabled: { type: Boolean, default: true }, // global kill switch for serving
    dailyFeeKobo: { type: Number, default: 100000, min: 0 }, // ₦1,000 / campaign / day
    pricingPolicy: { type: String, enum: ['flat', 'tiered'], default: 'flat' },
    tiers: {
      type: [{ _id: false, minDays: { type: Number, min: 2 }, percentOff: { type: Number, min: 1, max: 90 } }],
      default: [],
    },
    minDurationDays: { type: Number, default: 1, min: 1 },
    maxDurationDays: { type: Number, default: 30, min: 1 },
    maxDescriptionWords: { type: Number, default: 500, min: 1 },
    maxTitleChars: { type: Number, default: 80, min: 10 },
    maxKeywordChars: { type: Number, default: 30, min: 2 },
    maxCampaignsPerCheckout: { type: Number, default: 10, min: 1 },
    maxActiveCampaignsPerAdvertiser: { type: Number, default: 20, min: 1 },
    imageTargetBytes: { type: Number, default: 1024 * 1024 },
    imageMaxBytes: { type: Number, default: 2 * 1024 * 1024 }, // absolute upload ceiling
    retentionDays: { type: Number, default: 7, min: 1 }, // post-expiry dashboard retention
    rejectedRetentionDays: { type: Number, default: 30, min: 1 }, // rejected, not resubmitted
    // Serving
    maxAdsPerStudentPerDay: { type: Number, default: 3, min: 1 },
    maxSameCampaignPerStudentPerDay: { type: Number, default: 1, min: 1 },
    // Anonymized training data (see AdDecision)
    trainingLoggingEnabled: { type: Boolean, default: true },
    trainingRetentionDays: { type: Number, default: 365, min: 30, max: 1095 },
    // Legal copy the advertiser must accept before submitting
    termsVersion: { type: String, default: '2026-01' },
    termsUrl: { type: String, default: 'https://www.testflow.com.ng/ads/terms' },
    contentRulesUrl: { type: String, default: 'https://www.testflow.com.ng/ads/rules' },
    privacyUrl: { type: String, default: 'https://www.testflow.com.ng/privacy' },
  },
  { timestamps: true },
);

adSettingsSchema.statics.getInstance = async function getInstance() {
  const existing = await this.findOne();
  if (existing) return existing;
  try {
    return await this.create({});
  } catch (e) {
    if (e?.code === 11000) return this.findOne();
    throw e;
  }
};

export const AdSettings = mongoose.model('AdSettings', adSettingsSchema);
