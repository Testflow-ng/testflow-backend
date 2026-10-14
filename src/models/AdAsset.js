import mongoose from 'mongoose';

/** An optimized ad image stored in Cloudflare R2. Unattached assets are swept after 24h. */
const adAssetSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    storageKey: { type: String, required: true }, // R2 object key (for deletion)
    url: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
    format: { type: String, required: true },
    sha256: { type: String, required: true },
    attachedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

adAssetSchema.index({ attachedAt: 1, createdAt: 1 }); // orphan sweep

export const AdAsset = mongoose.model('AdAsset', adAssetSchema);
