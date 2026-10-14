/**
 * Tenant scoping helpers (Testflow for Everyone).
 *
 * Every tenant-owned document carries `organization`. All tenant reads/writes
 * go through these helpers so an `organization` condition can never be forgotten.
 * Anything that reaches the database without one throws (default-deny).
 */
export const ORG_ROLES = Object.freeze(['owner', 'admin', 'examiner', 'student']);

/** Rank for role comparisons: owner > admin > examiner > student. */
const RANK = Object.freeze({ student: 0, examiner: 1, admin: 2, owner: 3 });

export const orgRoleRank = (role) => RANK[role] ?? -1;

/** Does `actual` satisfy one of `allowed` (exact match, no hierarchy)? */
export const orgRoleAllowed = (actual, allowed) => allowed.includes(actual);

/** Merge `{ organization }` into a Mongoose filter. The caller-supplied filter never wins. */
export const scopedFilter = (orgId, filter = {}) => ({ ...filter, organization: orgId });

/**
 * Throw unless `filter` carries an `organization` condition — the default-deny
 * guard for tenant models. Call before every tenant query/update.
 */
export const assertScoped = (filter) => {
  const hasOrg =
    filter &&
    (Object.hasOwn(filter, 'organization') ||
      (Array.isArray(filter.$and) && filter.$and.some((c) => c && Object.hasOwn(c, 'organization'))));
  if (!hasOrg) {
    throw new Error('orgScope: tenant query without an organization condition is forbidden');
  }
  return filter;
};

/** `scoped(Model, orgId)` — minimal tenant-scoped data access for a Mongoose model. */
export const scoped = (Model, orgId) => ({
  find: (filter = {}, ...rest) => Model.find(scopedFilter(orgId, assertScoped(scopedFilter(orgId, filter))), ...rest),
  findOne: (filter = {}, ...rest) => Model.findOne(scopedFilter(orgId, assertScoped(scopedFilter(orgId, filter))), ...rest),
  countDocuments: (filter = {}, ...rest) =>
    Model.countDocuments(scopedFilter(orgId, assertScoped(scopedFilter(orgId, filter))), ...rest),
  create: (doc = {}) => Model.create({ ...doc, organization: orgId }),
  updateOne: (filter = {}, update, ...rest) =>
    Model.updateOne(scopedFilter(orgId, assertScoped(scopedFilter(orgId, filter))), update, ...rest),
  findOneAndUpdate: (filter = {}, update, ...rest) =>
    Model.findOneAndUpdate(scopedFilter(orgId, assertScoped(scopedFilter(orgId, filter))), update, ...rest),
});
