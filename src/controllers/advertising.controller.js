import { asyncHandler } from '../middleware/asyncHandler.js';
import { advertisingConfig, listPlacements, resolvePlacement } from '../config/advertising.js';
import { evaluateEligibility } from '../services/advertising/eligibility.service.js';
import { advertisingHealth, reportingStatus } from '../services/advertising/reporting.service.js';
import { AppError } from '../utils/AppError.js';

/** GET /api/advertising/config — public. Provider switches plus the placement registry. */
export const getConfig = asyncHandler(async (_req, res) => {
  res.json({ advertising: advertisingConfig() });
});

/** GET /api/advertising/placements — public. Registered placements and their effective state. */
export const getPlacements = asyncHandler(async (_req, res) => {
  res.json({ placements: listPlacements() });
});

/**
 * GET /api/advertising/eligibility?placement=&consent=
 * Optional authentication: a guest gets the anonymous policy for the placement, a signed-in
 * student gets theirs. Never claims that a provider has an ad to show.
 */
export const getEligibility = asyncHandler(async (req, res) => {
  const result = await evaluateEligibility({
    user: req.user ?? null,
    placement: req.query.placement,
    consent: req.query.consent,
  });
  res.json({ eligibility: result });
});

/** GET /api/advertising/placements/:id — public. One placement, or 404 if unregistered. */
export const getPlacement = asyncHandler(async (req, res) => {
  const placement = resolvePlacement(req.params.id);
  if (!placement) throw new AppError(404, 'PLACEMENT_NOT_FOUND', 'That advertising placement is not registered.');
  res.json({ placement });
});

/** GET /api/advertising/admin/health — admin. Configuration, counts, reporting and issues. */
export const getHealth = asyncHandler(async (_req, res) => {
  res.json({ health: await advertisingHealth() });
});

/** GET /api/advertising/admin/reporting — admin. Explicit integration status, no fabricated metrics. */
export const getReporting = asyncHandler(async (_req, res) => {
  res.json({ reporting: reportingStatus() });
});
