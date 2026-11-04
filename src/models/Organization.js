import mongoose from 'mongoose';

export const PAYOUT_STATUSES = Object.freeze(['none', 'pending', 'active', 'failed']);

/**
 * Where an organisation's student money is paid out.
 *
 * `platformPercent` is Testflow's share of every student payment (exam, book or pass). It is set
 * server-side (from the plan or a platform setting) and is deliberately read-only to the
 * organisation: the console shows it, it can never send it. Paystack splits at source, so the
 * percentage is mirrored onto the subaccount as its `percentage_charge`.
 */
const payoutSchema = new mongoose.Schema(
  {
    bankCode: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    businessName: { type: String, trim: true },
    status: { type: String, enum: PAYOUT_STATUSES, default: 'none' },
    subaccountCode: { type: String, trim: true },
    platformPercent: { type: Number, default: 10, min: 0, max: 100 },
  },
  { _id: false },
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 2, maxlength: 40 },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active', index: true },
    ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    contactEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
    timezone: { type: String, trim: true, maxlength: 64, default: 'Africa/Lagos' },
    payout: { type: payoutSchema, default: () => ({}) },
  },
  { timestamps: true },
);

organizationSchema.index({ status: 1, createdAt: -1 });

organizationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Organization = mongoose.model('Organization', organizationSchema);
