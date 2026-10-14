import mongoose from 'mongoose';
import { ALL_STATUSES } from '../utils/ads/campaignState.js';

const { ObjectId } = mongoose.Schema.Types;

const statsSchema = new mongoose.Schema(
  {
    eligibleRequests: { type: Number, default: 0 }, // serve responses that included this ad
    impressions: { type: Number, default: 0 },
    uniqueViewers: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    whatsappClicks: { type: Number, default: 0 },
    skips: { type: Number, default: 0 },
  },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    advertiser: { type: ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    image: { type: ObjectId, ref: 'AdAsset', required: true },
    destination: {
      type: { type: String, enum: ['url', 'whatsapp'], required: true },
      url: { type: String },
      whatsapp: { type: String }, // digits only, international format
      _id: false,
    },
    keywords: { type: [String], validate: (v) => v.length <= 3 },

    status: { type: String, enum: ALL_STATUSES, default: 'draft', required: true },
    paymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid', 'refund_due', 'refunded'], default: 'unpaid' },

    durationDays: { type: Number, required: true, min: 1 },
    dailyFeeKobo: { type: Number, required: true }, // snapshot at creation/edit
    priceKobo: { type: Number, required: true }, // server-calculated
    currency: { type: String, default: 'NGN' },
    preferredStartDate: { type: Date }, // optional, UTC midnight; never in the past at submit
    payment: { type: ObjectId, ref: 'AdPayment' }, // the paid checkout

    terms: { _id: false, version: String, acceptedAt: Date, ip: String },

    submittedAt: Date, // payment verified → entered review
    approvedAt: Date,
    startsAt: Date, // publication start (set on approval)
    endsAt: Date, // startsAt + durationDays
    expiredAt: Date,
    rejectedAt: Date,
    rejectionReason: String,
    suspendedAt: Date,
    suspensionReason: String,
    removedAt: Date,
    archivedAt: Date,
    archivedFrom: String, // status before archiving
    // After this instant the campaign is invisible and eligible for purge.
    purgeAt: { type: Date, index: true },
    purgeStartedAt: Date,
    republishedFrom: { type: ObjectId, ref: 'Campaign' },

    stats: { type: statsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

campaignSchema.index({ advertiser: 1, status: 1, createdAt: -1 }); // advertiser dashboard
campaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 }); // serving + lifecycle worker
campaignSchema.index({ status: 1, submittedAt: 1 }); // admin review queue
campaignSchema.index({ image: 1 }); // "is this image still referenced?"

campaignSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_d, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.purgeStartedAt;
    return ret;
  },
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
