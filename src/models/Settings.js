import mongoose from 'mongoose';

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
  },
  { timestamps: true },
);

// We only ever want one settings document
settingsSchema.statics.getInstance = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

export const Settings = mongoose.model('Settings', settingsSchema);
