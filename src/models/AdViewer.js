import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Distinct viewer marker per campaign: HMAC(student, campaign) — unlinkable across campaigns. */
const adViewerSchema = new mongoose.Schema(
  {
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    viewerHash: { type: String, required: true },
  },
  { versionKey: false },
);

adViewerSchema.index({ campaign: 1, viewerHash: 1 }, { unique: true });

export const AdViewer = mongoose.model('AdViewer', adViewerSchema);
