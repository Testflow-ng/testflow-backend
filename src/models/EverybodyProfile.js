import mongoose from 'mongoose';

/** Profile of an account's `everybody` membership (Testflow for Everyone). Becomes the seed for the Organization record. */
const everybodyProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    organizationName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  },
  { timestamps: true },
);

export const EverybodyProfile = mongoose.model('EverybodyProfile', everybodyProfileSchema);
