import { Organization } from '../models/Organization.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './asyncHandler.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Gate for org routes on `:organizationId`.
 * - Unknown org or no active membership → 404 (never confirm other tenants exist).
 * - Role not in `allowed` → 403.
 * - Non-active org blocks writes → 403 ORG_SUSPENDED / ORG_CLOSED.
 * Attaches `req.org` + `req.orgMembership`. Use after `authenticate`.
 */
export const requireOrgRole = (...allowed) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    const { organizationId } = req.params;
    const org = await Organization.findById(organizationId).lean();
    if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');

    const membership = await OrgMembership.findOne({
      organization: org._id,
      user: req.user._id,
      status: 'active',
    }).lean();
    // Same response for "no such org for you" and "no membership": do not leak tenants.
    if (!membership) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
    if (allowed.length && !allowed.includes(membership.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this resource.');
    }
    if (!SAFE_METHODS.has(req.method) && org.status !== 'active') {
      const code = org.status === 'suspended' ? 'ORG_SUSPENDED' : 'ORG_CLOSED';
      throw new AppError(403, code, `This organization is ${org.status}.`);
    }
    req.org = org;
    req.orgMembership = membership;
    return next();
  });
