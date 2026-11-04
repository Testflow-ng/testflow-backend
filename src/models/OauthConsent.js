import mongoose from 'mongoose';

/** A person's one-time approval of a site to sign them in with Testflow. Later logins skip the approval screen. */
const oauthConsentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    site: { type: String, required: true }, // the organisation site's host, taken from the verified return address
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
oauthConsentSchema.index({ user: 1, clientId: 1, site: 1 }, { unique: true });

export const OauthConsent = mongoose.model('OauthConsent', oauthConsentSchema);
