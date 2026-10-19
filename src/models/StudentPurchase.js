import mongoose from 'mongoose';

export const PURCHASE_STATUSES = Object.freeze(['initialized', 'paid', 'failed', 'abandoned', 'refunded']);

/**
 * A one-time purchase of a student plan (see `config/plans.js`). This is the auditable transaction
 * history for the ad-free / live-CBT entitlement: the entitlement itself says what is held now,
 * this says how it was paid for.
 *
 * Amounts are stored in minor units and are copied from the catalogue at checkout time, never from
 * the request. `planSnapshot` freezes the terms of the purchase so a later price or duration change
 * cannot rewrite history (the same pattern as `Subscription.planSnapshot`).
 */
const studentPurchaseSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // e.g. TFS-<hex>
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planKey: { type: String, required: true },
    planSnapshot: {
      name: { type: String, required: true },
      priceMinor: { type: Number, required: true },
      currency: { type: String, required: true, uppercase: true },
      durationDays: { type: Number, required: true },
      entitlementKeys: { type: [String], default: [] },
    },
    amountKobo: { type: Number, required: true },
    currency: { type: String, required: true, default: 'NGN', uppercase: true },
    status: { type: String, enum: PURCHASE_STATUSES, default: 'initialized' },
    provider: { type: String, enum: ['paystack', 'none'], default: 'none' },
    authorizationUrl: { type: String },
    providerTransactionId: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    paidAt: { type: Date },
    verifiedAt: { type: Date },
    refundedAt: { type: Date },
    refundId: { type: String },
    revokedReason: { type: String, default: null },
    // Recorded instead of activated when the provider reports a different amount/currency.
    mismatch: { type: mongoose.Schema.Types.Mixed, default: null },
    // Provider webhook events already applied, so a redelivery is a no-op.
    processedEventIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

studentPurchaseSchema.index({ user: 1, createdAt: -1 });
studentPurchaseSchema.index({ status: 1, createdAt: -1 });
// One purchase per (student, idempotency key). Deliberately a PARTIAL index, not `sparse`: a
// compound sparse index still indexes a document that has only one of the two fields, so two
// purchases by the same student that carry no key at all would both index as (user, null) and the
// second would be refused as a duplicate. A buyer is allowed to buy a second pass.
studentPurchaseSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

studentPurchaseSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const StudentPurchase = mongoose.model('StudentPurchase', studentPurchaseSchema);
