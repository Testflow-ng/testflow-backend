import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Subscription } from '../models/Subscription.js';
import { AppError } from '../utils/AppError.js';
import * as orgCtrl from '../controllers/organization.controller.js';

const router = Router();

/**
 * The upgrade/renew verbs are flat (`/subscriptions/:id/...`) because the plan page knows only the
 * subscription id. Resolve its organisation into `:organizationId` so the standard role guard can
 * run, and 404 an unknown one rather than leak its existence.
 */
const orgFromSub = asyncHandler(async (req, _res, next) => {
  const sub = await Subscription.findById(req.params.id).select('organization').lean();
  if (!sub) throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  req.params.organizationId = String(sub.organization);
  next();
});

/** POST /api/v1/everybody/organizations/:organizationId/subscriptions
 *  body: { planKey: 'pro' | 'studio' }
 *  Creates a pending subscription; the org starts with no subscription (pending).
 *  Auth: owner or admin.
 */
router.post(
  '/organizations/:organizationId/subscriptions',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.createSubscription,
);

/** GET /api/v1/everybody/organizations/:organizationId/subscriptions
 *  Lists the org's current subscription + entitlements.
 *  Auth: owner or admin.
 */
router.get(
  '/organizations/:organizationId/subscriptions',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.listMySubs,
);

/** GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id
 *  Gets a specific subscription by id.
 *  Auth: owner or admin.
 */
router.get(
  '/organizations/:organizationId/subscriptions/:id',
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
  '/organizations/:organizationId/subscriptions/:id',
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
  '/organizations/:organizationId/subscriptions/:id/checkout',
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
  '/organizations/:organizationId/subscriptions/:id/verify',
  authenticate,
  requireOrgRole('owner', 'admin'),
  orgCtrl.verify,
);

/** POST /api/v1/everybody/subscriptions/:id/upgrade
 *  body: { planKey }
 *  Immediate prorated checkout for an upgrade; `200 {}` for a scheduled downgrade.
 *  Auth: owner or admin.
 */
router.post(
  '/subscriptions/:id/upgrade',
  authenticate,
  orgFromSub,
  requireOrgRole('owner', 'admin'),
  orgCtrl.upgradeSub,
);

/** POST /api/v1/everybody/subscriptions/:id/renew
 *  A full-period checkout for the current plan.
 *  Auth: owner or admin.
 */
router.post(
  '/subscriptions/:id/renew',
  authenticate,
  orgFromSub,
  requireOrgRole('owner', 'admin'),
  orgCtrl.renewSub,
);

/** GET /api/v1/everybody/payments/verify?reference=
 *  The callback page re-verifies; idempotent. Access is checked against the payer's membership.
 *  Auth: any signed-in user (the service checks owner/admin of the paying organisation).
 */
router.get('/payments/verify', authenticate, orgCtrl.verifySubPayment);

/** POST /api/v1/everybody/subscriptions/webhook
 *  Provider webhook: header x-paystack-signature
 *  Signature-checked, amount-checked, idempotent.
 *  Auth: public (provider sends this).
 */
router.post(
  '/subscriptions/webhook',
  orgCtrl.webhook,
);

export default router;