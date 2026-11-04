import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One checkout (one provider charge) covering one or more campaigns.
 * Financial record: NEVER deleted by the 7-day campaign retention job; only the
 * campaign-content snapshot is dropped when a campaign is purged.
 */
const adPaymentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // our reference, sent to provider
    advertiser: { type: ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String },
    items: [
      {
        _id: false,
        campaign: { type: ObjectId, required: true },
        campaignName: String, // cleared when the campaign is purged
        days: Number,
        dailyFeeKobo: Number,
        amountKobo: Number,
        campaignPurgedAt: Date,
      },
    ],
    amountKobo: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    provider: { type: String, required: true },
    authorizationUrl: String,
    providerTransactionId: String,
    status: { type: String, enum: ['initialized', 'paid', 'failed', 'abandoned', 'refunding', 'refunded'], default: 'initialized' },
    paidAt: Date,
    verifiedAt: Date,
    failureReason: String,
    refundedAt: Date,
    refundedBy: { type: ObjectId, ref: 'User' },
    refundReason: String,
    processedEventIds: [String], // webhook event ids already applied
  },
  { timestamps: true },
);

adPaymentSchema.index({ advertiser: 1, createdAt: -1 });
adPaymentSchema.index({ advertiser: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
adPaymentSchema.index({ status: 1, createdAt: 1 });
adPaymentSchema.index({ 'items.campaign': 1 });

adPaymentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_d, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.processedEventIds;
    delete ret.providerTransactionId;
    return ret;
  },
});

export const AdPayment = mongoose.model('AdPayment', adPaymentSchema);
