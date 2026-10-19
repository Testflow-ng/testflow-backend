import { Router } from 'express';
import * as ctrl from '../controllers/billing.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import {
  cancelSchema,
  checkoutSchema,
  grantEntitlementSchema,
  refundSchema,
  revokeEntitlementSchema,
  statusQuerySchema,
} from '../validators/advertising.schema.js';

/**
 * Student billing for the ad-free / live-CBT pass. Paystack is the one payment integration in the
 * project (`services/ads/payment`); this router only adds a product and an entitlement on top of it.
 */
const router = Router();

// Checkout starts a charge, so it is shared-rate-limited per account across instances.
const checkoutLimiter = sharedRateLimit({
  name: 'billing-ad-free-checkout',
  windowMs: 60 * 60 * 1000,
  max: 20,
  key: (r) => String(r.user?._id ?? r.ip),
});

router.get('/ad-free/products', ctrl.listProducts);

// Paystack -> us. No session, no CSRF token; HMAC over the raw body is the authentication.
router.post('/ad-free/webhook', ctrl.webhook);

router.get('/entitlement', authenticate, ctrl.getEntitlement);
router.post('/ad-free/checkout', authenticate, checkoutLimiter, validate(checkoutSchema), ctrl.checkout);
router.get('/ad-free/status', authenticate, validate(statusQuerySchema), ctrl.status);
router.post('/ad-free/cancel', authenticate, validate(cancelSchema), ctrl.cancel);

// Administrative.
router.post('/ad-free/refund', authenticate, authorize('admin'), validate(refundSchema), ctrl.refund);
router.post('/ad-free/entitlements/:userId/grant', authenticate, authorize('admin'), validate(grantEntitlementSchema), ctrl.grant);
router.post('/ad-free/entitlements/:userId/revoke', authenticate, authorize('admin'), validate(revokeEntitlementSchema), ctrl.revoke);

export default router;
