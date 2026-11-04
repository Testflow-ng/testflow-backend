import mongoose from 'mongoose';

/**
 * Anonymized ad-decision / training record. Deliberately NOT linked to
 * Campaign, AdServe or User: it carries no student id/hash, no session id and
 * no campaign content, so the 7-day campaign purge does not touch it and it can
 * outlive campaigns under its own retention (AdSettings.trainingRetentionDays).
 */
const featureSchema = new mongoose.Schema({}, { strict: false, _id: false });

const candidateSchema = new mongoose.Schema(
  {
    campaignKey: { type: String, required: true }, // keyed pseudonym, not the campaign id
    rank: Number,
    relevance: Number,
    impressionsToday: Number,
    features: featureSchema,
    selected: Boolean,
  },
  { _id: false },
);

const adDecisionSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, required: true },
    decisionId: { type: String, required: true, unique: true },
    serveId: { type: String }, // present only when an ad was served; links outcomes
    ts: { type: Date, required: true }, // hour precision
    day: { type: String, required: true },
    ranker: String,
    policy: { _id: false, name: String, propensity: Number, exploration: Boolean },
    outcome: { type: String, enum: ['served', 'no_ad'], required: true },
    noAdReason: { type: String, enum: ['frequency_capped', 'no_eligible_campaign'] },
    context: featureSchema,
    candidateCount: Number,
    candidates: [candidateSchema],
    selectedKey: String,
    label: {
      _id: false,
      impression: { type: Boolean, default: false },
      visibleMs: { type: Number, default: null },
      click: { type: Boolean, default: false },
      whatsappClick: { type: Boolean, default: false },
      skip: { type: Boolean, default: false },
    },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false },
);

adDecisionSchema.index({ serveId: 1 }, { unique: true, partialFilterExpression: { serveId: { $type: 'string' } } });
adDecisionSchema.index({ ts: 1 }); // export + retention sweep
adDecisionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 }); // safety-net TTL

export const AdDecision = mongoose.model('AdDecision', adDecisionSchema);
