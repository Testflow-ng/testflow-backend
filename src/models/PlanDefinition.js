import mongoose from 'mongoose';
import { PLAN_KEYS as PLAN_KEY_LIST } from '../config/planFeatures.js';

export const PLAN_KEYS = Object.freeze([...PLAN_KEY_LIST]);

const entitlementsSchema = new mongoose.Schema({
  adsEnabled: { type: Boolean, default: true },
  // The feature matrix the console reads. `maxExams: null` is unlimited.
  maxExams: { type: Number, default: null },
  questionBanks: { type: Boolean, default: false },
  announcements: { type: Boolean, default: false },
  reports: { type: Boolean, default: false },
  paidExams: { type: Boolean, default: false },
  liveCbt: { type: Boolean, default: false },
  maxStudents: { type: Number, default: null },
  maxActiveExams: { type: Number, default: null },
  maxExamsPerMonth: { type: Number, default: null },
  customDomain: { type: Boolean, default: false },
  storageMb: { type: Number, default: null },
  maxImages: { type: Number, default: null },
  communityEnabled: { type: Boolean, default: false },
});

const planDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, enum: PLAN_KEYS, unique: true, required: true },
    name: { type: String, required: true },
    priceMinor: { type: Number, required: true },
    currency: { type: String, required: true, default: 'NGN', uppercase: true },
    interval: { type: String, required: true, enum: ['month', 'year'], default: 'month' },
    available: { type: Boolean, default: true },
    entitlements: { type: entitlementsSchema, default: {} },
    sortOrder: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// `key` is already unique on the field above; a second, non-unique `key` index would take the
// same auto-generated name and make `init()` fail with IndexKeySpecsConflict.
planDefinitionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const PlanDefinition = mongoose.model('PlanDefinition', planDefinitionSchema);