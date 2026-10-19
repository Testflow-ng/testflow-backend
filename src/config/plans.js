/**
 * The normal TestFlow (student) plan catalogue.
 *
 * This is the student counterpart to the Everybody catalogue in `scripts/seed-plans.js`, and it is
 * deliberately a separate list: Everybody plans are organization-scoped monthly subscriptions with
 * their own lifecycle (`models/Subscription.js`), while a student plan here is a one-time pass with
 * an explicit duration. The product has no student recurring billing, and inventing one would mean
 * storing a mandate we cannot service.
 *
 * Prices are in minor units (kobo), the same convention as `PLAN_SEED`. They are code, not
 * database rows, because a price change here is a deployment, exactly like the Everybody seed.
 * The client never sends a price: checkout takes a `planKey` and the amount is read from here.
 *
 * ASSUMPTION (flagged for product sign-off): the two price points below are placeholders chosen to
 * match the existing ₦ scale. They are the only numbers in this slice that are not derived from the
 * codebase.
 */

export const STUDENT_PLANS = Object.freeze([
  Object.freeze({
    key: 'pass_30d',
    name: 'Student Pass',
    description: '30 days of hosted live sessions, an ad-free TestFlow and the full Library.',
    priceMinor: 250000, // ₦2,500
    currency: 'NGN',
    durationDays: 30,
    available: true,
    // Keyed by the real entitlement keys so a plan and a grant share one vocabulary.
    entitlements: Object.freeze({ ad_free: true, live_cbt_host: true, library: true }),
    sortOrder: 1,
  }),
  Object.freeze({
    key: 'pass_90d',
    name: 'Student Pass (term)',
    description: '90 days of hosted live sessions, an ad-free TestFlow and the full Library.',
    priceMinor: 600000, // ₦6,000
    currency: 'NGN',
    durationDays: 90,
    available: true,
    entitlements: Object.freeze({ ad_free: true, live_cbt_host: true, library: true }),
    sortOrder: 2,
  }),
]);

export const STUDENT_PLAN_KEYS = Object.freeze(STUDENT_PLANS.map((p) => p.key));

/** The catalogue entry for a key, or null. Never trust a client price: callers price from here. */
export const findStudentPlan = (key) => STUDENT_PLANS.find((p) => p.key === key) ?? null;

/** The plans that remove advertising. Every current pass does; kept as a filter for clarity. */
export const adFreePlans = () => STUDENT_PLANS.filter((p) => p.available && p.entitlements.ad_free);

/** Wire shape. `entitlements` is what the plan unlocks, not what the user holds. */
export const toPlanView = (plan) => ({
  key: plan.key,
  name: plan.name,
  description: plan.description,
  priceMinor: plan.priceMinor,
  currency: plan.currency,
  durationDays: plan.durationDays,
  removesAds: !!plan.entitlements.ad_free,
  entitlements: {
    adFree: !!plan.entitlements.ad_free,
    liveCbtHost: !!plan.entitlements.live_cbt_host,
    library: !!plan.entitlements.library,
  },
});
