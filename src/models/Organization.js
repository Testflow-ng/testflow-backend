import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 2, maxlength: 40 },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active', index: true },
    ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    contactEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
    timezone: { type: String, trim: true, maxlength: 64, default: 'Africa/Lagos' },
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
