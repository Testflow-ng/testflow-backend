import mongoose from 'mongoose';

/** What a student can hold. Both are granted by a plan or by an administrator. */
export const ENTITLEMENT_KEYS = Object.freeze(['ad_free', 'live_cbt_host']);

/** Where a live entitlement came from. `plan` is reserved for a plan bundled without a purchase. */
export const ENTITLEMENT_SOURCES = Object.freeze(['purchase', 'plan', 'admin']);

/**
 * One row per (student, entitlement). Deliberately not a blob on User: an entitlement has its own
 * lifecycle (starts, expires, gets revoked after a refund) and the reads are by key.
 *
 * `expiresAt: null` means "does not expire" (an administrator grant). Liveness is always evaluated
 * against a clock, never stored, so an expired pass restores eligibility without a job having run.
 */
const studentEntitlementSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, enum: ENTITLEMENT_KEYS, required: true },
    active: { type: Boolean, default: true },
    source: { type: String, enum: ENTITLEMENT_SOURCES, required: true },
    planKey: { type: String },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentPurchase' },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);

// One live row per student per entitlement; granting again updates the row in place.
studentEntitlementSchema.index({ user: 1, key: 1 }, { unique: true });
// Supports the maintenance/expiry sweep and the admin counts.
studentEntitlementSchema.index({ key: 1, active: 1, expiresAt: 1 });

/** Liveness is a function of the clock, so an expired row is inert without being rewritten. */
export const isEntitlementLive = (entitlement, now = new Date()) => {
  if (!entitlement) return false;
  if (entitlement.active === false) return false;
  if (entitlement.revokedAt) return false;
  const expiresAt = entitlement.expiresAt ? new Date(entitlement.expiresAt) : null;
  return !expiresAt || expiresAt.getTime() > now.getTime();
};

studentEntitlementSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const StudentEntitlement = mongoose.model('StudentEntitlement', studentEntitlementSchema);
