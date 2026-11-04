import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Deduplicated engagement events. `eventId` (client UUID) is the idempotency
 * key; (serveId, type) is unique so a serve yields at most one event per type.
 */
const adEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    serveId: { type: String, required: true },
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    type: { type: String, enum: ['impression', 'click', 'whatsapp_click', 'skip'], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

adEventSchema.index({ serveId: 1, type: 1 }, { unique: true });
adEventSchema.index({ campaign: 1, createdAt: 1 }); // purge by campaign

export const AdEvent = mongoose.model('AdEvent', adEventSchema);
