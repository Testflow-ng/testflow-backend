import { Router } from 'express';
import * as ctrl from '../controllers/advertising.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { eligibilityQuerySchema } from '../validators/advertising.schema.js';

/**
 * Advertising configuration and eligibility.
 *
 * Deliberately a separate namespace from `/api/ads`: that prefix is the Testflow Ads marketplace
 * (advertiser campaigns, their billing, their serving), which this slice does not touch. These
 * routes only answer "which providers may run here, and for whom".
 */
const router = Router();

// Public: the frontend needs the provider switches and slots to decide what it may render.
router.get('/config', ctrl.getConfig);
router.get('/placements', ctrl.getPlacements);
router.get('/placements/:id', ctrl.getPlacement);

// Optional session: guests get the anonymous policy, students get theirs.
router.get('/eligibility', optionalAuth, validate(eligibilityQuerySchema), ctrl.getEligibility);

// Administrative: configuration health and the reporting integration status.
router.get('/admin/health', authenticate, authorize('admin'), ctrl.getHealth);
router.get('/admin/reporting', authenticate, authorize('admin'), ctrl.getReporting);

export default router;
