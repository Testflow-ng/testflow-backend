import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Per-campaign per-UTC-day rollup; analytics read this, never raw events. */
const adDailyStatSchema = new mongoose.Schema(
  {
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    eligibleRequests: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    uniqueViewers: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    whatsappClicks: { type: Number, default: 0 },
    skips: { type: Number, default: 0 },
  },
  { versionKey: false },
);

adDailyStatSchema.index({ campaign: 1, day: 1 }, { unique: true });
adDailyStatSchema.index({ day: 1 });

export const AdDailyStat = mongoose.model('AdDailyStat', adDailyStatSchema);
