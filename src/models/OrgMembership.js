import mongoose from 'mongoose';

const orgMembershipSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'examiner', 'student'], required: true },
    status: { type: String, enum: ['active', 'suspended', 'removed'], default: 'active' },
    studentRef: { type: String, trim: true, maxlength: 64 },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

orgMembershipSchema.index({ organization: 1, user: 1 }, { unique: true });
orgMembershipSchema.index({ organization: 1, role: 1, status: 1 });
orgMembershipSchema.index({ user: 1 });
// Exactly one owner per org (service also enforces; the index is the backstop).
orgMembershipSchema.index(
  { organization: 1 },
  { unique: true, partialFilterExpression: { role: 'owner', status: 'active' } },
);

export const OrgMembership = mongoose.model('OrgMembership', orgMembershipSchema);
