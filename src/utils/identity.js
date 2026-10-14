/**
 * Central identity helpers: ONE account per person (unique email), with one
 * membership per product the person uses. `User.role` is only the account's
 * global level (student|admin|super_admin; legacy 'advertiser' until migrated).
 * Access to a product is decided by memberships, never by `role`.
 */
export const PRODUCTS = Object.freeze({
  student: { roles: ['student'], defaultRole: 'student', label: 'TestFlow CBT' },
  ads: { roles: ['advertiser'], defaultRole: 'advertiser', label: 'TestFlow Ads' },
  everybody: { roles: ['organizer'], defaultRole: 'organizer', label: 'Testflow for Everyone' },
  // future products: add an entry here (and a profile summary in identity.service)
});
export const PRODUCT_KEYS = Object.freeze(Object.keys(PRODUCTS));
export const isProduct = (p) => Object.hasOwn(PRODUCTS, p);
/** Products an account may add to itself via POST /api/auth/memberships. */
export const isJoinable = (p) => isProduct(p);

/**
 * Memberships of a user. Accounts created before the migration have none, so
 * they are derived from the legacy `role` — nothing breaks if the migration has
 * not been run yet. Global admins carry no product memberships.
 */
export const effectiveMemberships = (user) => {
  const own = user?.memberships ?? [];
  if (own.length) return own;
  if (user?.role === 'student') return [{ product: 'student', role: 'student' }];
  if (user?.role === 'advertiser') return [{ product: 'ads', role: 'advertiser' }];
  return [];
};

export const hasMembership = (user, product, role) =>
  effectiveMemberships(user).some((m) => m.product === product && (!role || m.role === role));

/** The product context to start in when none was requested. */
export const defaultActiveProduct = (user, preferred) => {
  const ms = effectiveMemberships(user);
  if (preferred && ms.some((m) => m.product === preferred)) return preferred;
  return ms[0]?.product ?? null;
};

export const isAdminRole = (role) => role === 'admin' || role === 'super_admin';

/** Mongo filter matching student accounts (membership-based, legacy-role fallback). */
export const STUDENT_FILTER = {
  $or: [{ 'memberships.product': 'student' }, { 'memberships.0': { $exists: false }, role: 'student' }],
};
export const studentQuery = (extra = {}) => ({ ...extra, $and: [...(extra.$and ?? []), STUDENT_FILTER] });
