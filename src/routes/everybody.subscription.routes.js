import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import * as orgCtrl from '../controllers/organization.controller.js';

const router = Router();

/** POST /api/v1/everybody/organizations/:organizationId/subscriptions
 *  body: { planKey: 'pro' | 'studio' }
 *  Creates a pending subscription; the org starts with no subscription (pending).
 *  Auth: owner or admin.
 */
router.post(
  '/:organizationId/subscriptions',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.createSubscription,
);

/** GET /api/v1/everybody/organizations/:organizationId/subscriptions
 *  Lists the org's current subscription + entitlements.
 *  Auth: owner or admin.
 */
router.get(
  '/:organizationId/subscriptions',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.listMySubs,
);

/** GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id
 *  Gets a specific subscription by id.
 *  Auth: owner or admin.
 */
router.get(
  '/:organizationId/subscriptions/:id',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.getSub,
);

/** PATCH /api/v1/everybody/organizations/:organizationId/subscriptions/:id
 *  body: { cancelAtPeriodEnd: true } | { planKey: 'pro' | 'studio' }
 *  Cancel or upgrade/downgrade.
 *  Auth: owner or admin.
 */
router.patch(
  '/:organizationId/subscriptions/:id',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.updateSub,
);

/** POST /api/v1/everybody/subscriptions/:id/checkout
 *  body: { Idempotency-Key: uuid }
 *  Returns { paymentId, reference, amountKobo, currency, authorizationUrl }
 *  Auth: owner or admin.
 */
router.post(
  '/:organizationId/subscriptions/:id/checkout',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.checkout,
);

/** GET /api/v1/everybody/subscriptions/:id/verify
 *  Query: reference
 *  Re-verifies with provider; returns subscription + payment summary.
 *  Auth: owner or admin.
 */
router.get(
  '/:organizationId/subscriptions/:id/verify',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.verify,
);

/** POST /api/v1/everybody/subscriptions/webhook
 *  Provider webhook: header x-paystack-signature
 *  Dispatches by reference prefix; idempotent.
 *  Auth: public (provider sends this).
 */
router.post(
  '/webhook',
  orgCtrl.webhook,
);

export default router;