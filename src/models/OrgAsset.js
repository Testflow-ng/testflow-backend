import mongoose from 'mongoose';

/**
 * An uploaded asset belonging to an organisation's site: a logo, favicon, hero, or inline image.
 *
 * Only the pointer is stored here. `storageKey` is the object key in the media store (what a
 * retention job would delete) and `url` is what the published site renders. `SiteConfig` points
 * at these by id (`brand.logoAssetId`, `brand.faviconAssetId`).
 */
const orgAssetSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    kind: { type: String, enum: ['logo', 'favicon', 'hero', 'image'], required: true },
    storageKey: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgAssetSchema.index({ organization: 1, createdAt: -1 });

orgAssetSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgAsset = mongoose.model('OrgAsset', orgAssetSchema);
