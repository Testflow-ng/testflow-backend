import mongoose from 'mongoose';

export const SUB_STATUSES = Object.freeze(['pending', 'active', 'past_due', 'expired', 'cancelled']);

const subscriptionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    planKey: { type: String, enum: ['pro', 'studio'], required: true },
    planSnapshot: {
      priceMinor: { type: Number, required: true },
      currency: { type: String, required: true, default: 'NGN', uppercase: true },
      entitlements: {
        type: new mongoose.Schema({
          adsEnabled: { type: Boolean },
          maxStudents: { type: Number },
          maxActiveExams: { type: Number },
          maxExamsPerMonth: { type: Number },
          customDomain: { type: Boolean },
          storageMb: { type: Number },
          communityEnabled: { type: Boolean },
        }),
        default: {},
      },
      status: { type: String, enum: SUB_STATUSES, default: 'pending' },
      currentPeriodStart: { type: Date, default: Date.now },
      currentPeriodEnd: { type: Date, required: true },
      cancelAtPeriodEnd: { type: Boolean, default: false },
      pendingPlanKey: { type: String, enum: ['pro', 'studio'] },
      graceEndsAt: { type: Date },
      lastPaymentId: { type: String },
    },
    idempotencyKey: { type: String, unique: true },
    provider: { type: String, enum: ['paystack', 'none'] },
    providerReference: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

subscriptionSchema.index({ organization: 1, status: 1 });
subscriptionSchema.index({ idempotencyKey: 1 }, { unique: true });

subscriptionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Subscription = mongoose.model('Subscription', subscriptionSchema);