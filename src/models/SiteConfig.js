import mongoose from 'mongoose';

const siteConfigSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    templateKey: { type: String, enum: ['classic', 'modern', 'minimal'], default: 'modern' },
    draft: {
      type: new mongoose.Schema({
        brand: { name: { type: String, trim: true, maxlength: 120 }, logoAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgAsset' }, faviconAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgAsset' }, primaryColor: { type: String, pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' }, accentColor: { type: String, pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' } },
        seo: { title: { type: String, maxLength: 70 }, description: { type: String, maxLength: 160 } },
        nav: { type: { type: 'array', items: { type: 'object', properties: { label: { type: 'string', maxLength: 50 }, href: { type: 'string' } } }, maxItems: 8, default: [] } },
        sections: { type: { type: 'array', items: { type: 'object' }, maxItems: 12, default: [] } },
      }),
      validated: { type: Boolean, default: false },
    },
    published: {
      type: new mongoose.Schema({
        brand: { name: { type: String, trim: true, maxlength: 120 }, logoAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgAsset' }, faviconAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgAsset' }, primaryColor: { type: String, pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' }, accentColor: { type: String, pattern: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$' } },
        seo: { title: { type: String, maxLength: 70 }, description: { type: String, maxLength: 160 } },
        nav: { type: { type: 'array', items: { type: 'object', properties: { label: { type: 'string', maxLength: 50 }, href: { type: 'string' } } }, maxItems: 8 } },
        sections: { type: { type: 'array', items: { type: 'object' } } },
        publishedAt: { type: Date, default: Date.now },
        publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      }),
      publishedVersion: { type: Number, default: 0 },
    },
    draftVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

siteConfigSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);