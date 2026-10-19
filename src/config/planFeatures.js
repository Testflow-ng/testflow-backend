/**
 * What each plan allows.
 *
 * Kept in one place because three readers need the same answer: the seed writes it into
 * `PlanDefinition`, `entitlementsFor` falls back to it when a plan row predates a field, and the
 * console needs a sane Free plan even on a database that has never run the seed.
 *
 * `maxExams: null` means unlimited. `adsEnabled` is true for Free and Pro, false for Studio.
 */
export const PLAN_KEYS = Object.freeze(['free', 'pro', 'studio']);

export const PLAN_ENTITLEMENTS = Object.freeze({
  free: Object.freeze({
    adsEnabled: true,
    maxExams: 3,
    questionBanks: false,
    announcements: false,
    reports: false,
    paidExams: false,
    liveCbt: false,
    maxStudents: null,
    maxActiveExams: null,
    maxExamsPerMonth: null,
    customDomain: false,
    // Image storage cap and the number of stored images, so one plan cannot fill the bucket.
    storageMb: 50,
    maxImages: 50,
    communityEnabled: false,
  }),
  pro: Object.freeze({
    adsEnabled: true,
    maxExams: null,
    questionBanks: true,
    announcements: true,
    reports: true,
    paidExams: false,
    liveCbt: false,
    maxStudents: null,
    maxActiveExams: null,
    maxExamsPerMonth: null,
    customDomain: false,
    storageMb: 200,
    maxImages: 300,
    communityEnabled: false,
  }),
  studio: Object.freeze({
    adsEnabled: false,
    maxExams: null,
    questionBanks: true,
    announcements: true,
    reports: true,
    paidExams: true,
    liveCbt: true,
    maxStudents: 500,
    maxActiveExams: 50,
    maxExamsPerMonth: 100,
    customDomain: true,
    storageMb: 500,
    maxImages: 2000,
    communityEnabled: true,
  }),
});

/** The plan a feature needs, for the `details` a `402 PLAN_REQUIRED` carries. */
export const PLAN_FOR_FEATURE = Object.freeze({
  exam_limit: 'pro',
  question_banks: 'pro',
  announcements: 'pro',
  reports: 'pro',
  paid_exams: 'studio',
  live_cbt: 'studio',
});

export const planEntitlements = (planKey) => PLAN_ENTITLEMENTS[planKey] ?? PLAN_ENTITLEMENTS.free;
