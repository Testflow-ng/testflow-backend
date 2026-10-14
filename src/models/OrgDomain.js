import mongoose from 'mongoose';

const orgDomainSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    hostname: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    type: { type: String, enum: ['subdomain', 'custom'], required: true },
    status: { type: String, enum: ['pending', 'verified', 'active', 'failed', 'removed'], default: 'pending', index: true },
    verification: {
      token: { type: String, select: false },
      method: { type: String, enum: ['dns', 'cname'], default: 'dns' },
      expiresAt: { type: Date },
      lastCheckedAt: { type: Date },
      failures: { type: Number, default: 0 },
    },
    isPrimary: { type: Boolean, default: false },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);

orgDomainSchema.index({ organization: 1, hostname: 1 }, { unique: true, partialFilterExpression: { status: { $ne: 'removed' } } });
orgDomainSchema.index({ status: 1, createdAt: -1 });

orgDomainSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgDomain = mongoose.model('OrgDomain', orgDomainSchema);