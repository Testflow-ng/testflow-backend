import mongoose from 'mongoose';

export const ORG_PAYMENT_ITEMS = Object.freeze(['exam', 'book', 'pass']);
export const ORG_PAYMENT_STATUSES = Object.freeze(['initialized', 'paid', 'failed', 'refunded']);

/**
 * One student payment to an organisation, with the split frozen onto it.
 *
 * The four amounts add up: `grossKobo` is what the student paid, `platformFeeKobo` is Testflow's
 * share, `orgShareKobo` is the organisation's share and `paystackFeeKobo` is the processor's cut.
 * They are copied here at settlement rather than recomputed, because the percentage can change and
 * an old row must keep the numbers it was settled at.
 */
const orgPaymentSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    item: { type: String, enum: ORG_PAYMENT_ITEMS, required: true },
    itemRef: { type: mongoose.Schema.Types.ObjectId },
    itemTitle: { type: String, trim: true, default: '' },
    reference: { type: String, required: true, unique: true },
    currency: { type: String, default: 'NGN', uppercase: true },
    grossKobo: { type: Number, required: true, min: 0 },
    platformFeeKobo: { type: Number, default: 0, min: 0 },
    orgShareKobo: { type: Number, default: 0, min: 0 },
    paystackFeeKobo: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ORG_PAYMENT_STATUSES, default: 'initialized' },
    provider: { type: String, default: 'paystack' },
    providerTransactionId: { type: String, trim: true, default: null },
    // The percentage the split was settled at. A later platform-setting change never rewrites it.
    platformPercent: { type: Number, default: null, min: 0, max: 100 },
    authorizationUrl: { type: String, trim: true, default: null },
    idempotencyKey: { type: String, trim: true },
    failureReason: { type: String, trim: true, default: null },
    refundReference: { type: String, trim: true, default: null },
    refundedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orgPaymentSchema.index({ organization: 1, createdAt: -1 });
orgPaymentSchema.index({ organization: 1, status: 1, createdAt: -1 });
orgPaymentSchema.index({ organization: 1, student: 1, item: 1, itemRef: 1, status: 1 });
// Only real keys are indexed, so two checkouts that never sent one never collide.
orgPaymentSchema.index(
  { organization: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

orgPaymentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgPayment = mongoose.model('OrgPayment', orgPaymentSchema);
