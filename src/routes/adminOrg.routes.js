import { Router } from 'express';
import * as admin from '../controllers/admin.organization.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import {
  listOrgsQuerySchema,
  getOrgSchema,
  suspendOrgSchema,
  reinstateOrgSchema,
  planEditSchema,
} from '../validators/everybody.schema.js';

const router = Router();

// GET /api/v1/admin/everybody: list all organizations
router.get('/', authenticate, authorize('super_admin'), validate(listOrgsQuerySchema), admin.list);

// GET /api/v1/admin/everybody/:organizationId: get one org
router.get('/:organizationId', authenticate, authorize('super_admin'), validate(getOrgSchema), admin.get);

// PATCH /api/v1/admin/everybody/:organizationId/suspend: suspend org
router.patch(
  '/:organizationId/suspend',
  authenticate,
  authorize('super_admin'),
  validate(suspendOrgSchema),
  admin.suspend,
);

// PATCH /api/v1/admin/everybody/:organizationId/reinstate: reinstate org
router.patch(
  '/:organizationId/reinstate',
  authenticate,
  authorize('super_admin'),
  validate(reinstateOrgSchema),
  admin.reinstate,
);

// PATCH /api/v1/admin/everybody/:organizationId/plan: edit plan
router.patch(
  '/:organizationId/plan',
  authenticate,
  authorize('super_admin'),
  validate(planEditSchema),
  admin.editPlan,
);

export default router;