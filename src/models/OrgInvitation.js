import mongoose from 'mongoose';

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

const orgInvitationSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: ['admin', 'examiner', 'student'], required: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    maxUses: { type: Number, default: 1, min: 1 },
    useCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

orgInvitationSchema.index({ organization: 1, email: 1 });
// Delete 7 days after expiry (grace for audit/late accepts).
orgInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: SEVEN_DAYS_SECONDS });

export const OrgInvitation = mongoose.model('OrgInvitation', orgInvitationSchema);
