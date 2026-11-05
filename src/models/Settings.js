import mongoose from 'mongoose';

const studentPlanSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    priceMinor: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    durationDays: { type: Number, required: true },
    available: { type: Boolean, default: true },
    comingSoon: { type: Boolean, default: false },
  },
  { _id: false },
);

const DEFAULT_STUDENT_PLANS = [
  {
    key: 'pass_30d',
    name: 'Plus',
    description: '30 days of ad-free study, Live CBT, early AI access, and custom CBT creation.',
    priceMinor: 50000,
    currency: 'NGN',
    durationDays: 30,
    available: true,
    comingSoon: false,
  },
  {
    key: 'pass_90d',
    name: 'Pro',
    description: 'Advanced power tools and expanded resources for serious exam preparation.',
    priceMinor: 150000,
    currency: 'NGN',
    durationDays: 90,
    available: false,
    comingSoon: true,
  },
];

const settingsSchema = new mongoose.Schema(
  {
    isPostUtmeActive: { type: Boolean, default: true },
    postUtmePrice: { type: Number, default: 2000 }, // Example default
    paymentAccountNumber: { type: String, default: '1234567890' },
    paymentBankName: { type: String, default: 'Test Bank' },
    paymentAccountName: { type: String, default: 'Testflow Admin' },
    // Testflow's share of every student payment to an organisation. Set by a super-admin, never by
    // the organisation. Kept low by design: organisers earn from their own paid exams.
    platformPercent: { type: Number, default: 5, min: 0, max: 50 },
    studentPlans: {
      type: [studentPlanSettingSchema],
      default: DEFAULT_STUDENT_PLANS,
    },
  },
  { timestamps: true },
);

// We only ever want one settings document
settingsSchema.statics.getInstance = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({ studentPlans: DEFAULT_STUDENT_PLANS });
  } else if (!settings.studentPlans || settings.studentPlans.length === 0) {
    settings.studentPlans = DEFAULT_STUDENT_PLANS;
    await settings.save();
  }
  return settings;
};

export const Settings = mongoose.model('Settings', settingsSchema);
