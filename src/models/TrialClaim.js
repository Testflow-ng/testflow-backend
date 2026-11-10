import mongoose from 'mongoose';

/**
 * One row per free Studio trial handed out. Raw IPs and device fingerprints are never stored:
 * only salted hashes, enough to recognise the same person coming back with another account.
 */
const trialClaimSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emailKey: { type: String, index: true },
    ipHash: { type: String, index: true },
    deviceHash: { type: String, index: true },
  },
  { timestamps: true },
);

export const TrialClaim = mongoose.model('TrialClaim', trialClaimSchema);
