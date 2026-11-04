import { AppError } from '../utils/AppError.js';
import { findSiteByHostname } from '../services/orgSite.service.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Resolve the organisation behind a tenant request.
 *
 * The frontend lives on another origin, so it states the address explicitly in `X-Tenant-Host`.
 * When the request is the browser itself (the HTML/OG endpoints, or a direct curl) the address is
 * read from the forwarded host or the host, with an explicit `?host=` as the last word. Unknown
 * and suspended addresses are a flat `404 TENANT_NOT_FOUND`, so one organisation's existence is
 * never confirmed on another's address.
 */
export const requestedTenantHost = (req) =>
  String(
    req.get('x-tenant-host') || req.query.host || req.get('x-forwarded-host') || req.hostname || '',
  )
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

export const resolveTenant = asyncHandler(async (req, _res, next) => {
  const resolved = await findSiteByHostname(requestedTenantHost(req));
  if (!resolved) throw new AppError(404, 'TENANT_NOT_FOUND', 'This site is not set up yet.');
  req.tenant = resolved;
  next();
});
