import mongoose from 'mongoose';

const advertiserProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true, trim: true, maxlength: 120 },
    contactPhone: { type: String, trim: true, maxlength: 20 },
    website: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

export const AdvertiserProfile = mongoose.model('AdvertiserProfile', advertiserProfileSchema);
