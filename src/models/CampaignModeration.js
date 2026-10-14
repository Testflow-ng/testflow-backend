import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Append-only lifecycle/moderation history for a campaign (purged with it). */
const campaignModerationSchema = new mongoose.Schema(
  {
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    actor: { type: ObjectId, ref: 'User' }, // null = system
    actorRole: { type: String, enum: ['advertiser', 'admin', 'super_admin', 'system'], default: 'system' },
    action: { type: String, required: true }, // submitted | payment_verified | approved | rejected | ...
    fromStatus: String,
    toStatus: String,
    reason: { type: String, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

campaignModerationSchema.index({ campaign: 1, createdAt: 1 });

export const CampaignModeration = mongoose.model('CampaignModeration', campaignModerationSchema);
