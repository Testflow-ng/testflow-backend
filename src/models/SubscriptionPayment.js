import mongoose from 'mongoose';

export const SUB_PAYMENT_STATUSES = Object.freeze(['initialized', 'paid', 'failed', 'abandoned', 'refunded']);
export const SUB_PAYMENT_METHODS = Object.freeze(['paystack_checkout', 'paystack_bank_transfer']);

const transferInstructionsSchema = new mongoose.Schema(
  {
    bankName: { type: String },
    accountName: { type: String },
    accountNumber: { type: String },
    amountKobo: { type: Number },
    currency: { type: String, uppercase: true },
    expiresAt: { type: Date },
    displayText: { type: String },
    transferReference: { type: String },
    channel: { type: String },
  },
  { _id: false },
);

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // e.g. SUB-abc123
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true },
    kind: { type: String, enum: ['new', 'renewal', 'upgrade'], required: true },
    planKey: { type: String, enum: ['pro', 'studio'], required: true },
    amountKobo: { type: Number, required: true },
    currency: { type: String, required: true, default: 'NGN', uppercase: true },
    status: { type: String, enum: SUB_PAYMENT_STATUSES, default: 'initialized' },
    provider: { type: String, enum: ['paystack', 'none'] },
    paymentMethod: { type: String, enum: SUB_PAYMENT_METHODS, default: 'paystack_checkout' },
    authorizationUrl: { type: String },
    // Native bank transfer (Paystack "Pay with Transfer") instructions returned by provider.
    // Persisted so refresh/status recovery does not create duplicate pending transactions.
    transferInstructions: { type: transferInstructionsSchema },
    providerTransactionId: { type: String },
    providerChannel: { type: String },
    idempotencyKey: { type: String },
    paidAt: { type: Date },
    verifiedAt: { type: Date },
    processedEventIds: [{ type: String }], // dedupe webhook event ids
  },
  { timestamps: true },
);

subscriptionPaymentSchema.index({ organization: 1, createdAt: 1 });
subscriptionPaymentSchema.index({ status: 1, createdAt: 1 });
// Only real keys are indexed, so two checkouts that never sent one never collide.
subscriptionPaymentSchema.index(
  { organization: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

subscriptionPaymentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const SubscriptionPayment = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);