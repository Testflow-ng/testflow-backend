import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import * as purchases from '../services/studentPurchase.service.js';
import { grantEntitlement, listAdFreePlans, revokeEntitlement, studentEntitlements } from '../services/studentPlan.service.js';

/** GET /api/billing/ad-free/products — public. The catalogue; prices come from here, never a client. */
export const listProducts = asyncHandler(async (_req, res) => {
  res.json({ products: listAdFreePlans() });
});

/**
 * GET /api/billing/entitlement — authenticated.
 * What this student holds, including the live-CBT hosting gate the frontend needs before it offers
 * the host button.
 */
export const getEntitlement = asyncHandler(async (req, res) => {
  res.json({ entitlement: await studentEntitlements(req.user._id) });
});

/** POST /api/billing/ad-free/checkout — authenticated, rate limited. */
export const checkout = asyncHandler(async (req, res) => {
  const { purchase, replay } = await purchases.startCheckout({
    user: req.user,
    planKey: req.body.planKey,
    idempotencyKey: req.body.idempotencyKey ?? null,
  });
  res.status(replay ? 200 : 201).json({ purchase: purchases.toPurchaseView(purchase) });
});

/**
 * GET /api/billing/ad-free/status?reference= — authenticated.
 * The entitlement, always; a specific purchase (re-verified with the provider) when asked for one.
 */
export const status = asyncHandler(async (req, res) => {
  const { entitlements, purchase } = await purchases.getStatus({
    user: req.user,
    reference: req.query.reference ?? null,
  });
  res.json({ entitlement: entitlements, purchase: purchase ? purchases.toPurchaseView(purchase) : null });
});

/** POST /api/billing/ad-free/cancel — authenticated. Abandons this student's own pending purchase. */
export const cancel = asyncHandler(async (req, res) => {
  const purchase = await purchases.cancelPurchase({ user: req.user, reference: req.body.reference });
  res.json({ purchase: purchases.toPurchaseView(purchase) });
});

/** POST /api/billing/ad-free/refund — admin. Refunds with the provider, then revokes. */
export const refund = asyncHandler(async (req, res) => {
  const purchase = await purchases.refundPurchase({
    actor: req.user,
    reference: req.body.reference,
    reason: req.body.reason ?? 'refund',
  });
  res.json({ purchase: purchases.toPurchaseView(purchase) });
});

/**
 * POST /api/billing/ad-free/webhook — provider-facing (Paystack), no session.
 * The signature is checked over the raw bytes before anything is read from the body.
 */
export const webhook = asyncHandler(async (req, res) => {
  const result = await purchases.handleWebhook({
    rawBody: req.rawBody,
    signature: req.get('x-paystack-signature'),
    body: req.body,
  });
  res.json(result);
});

const findUser = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Student not found.');
  return user;
};

/** POST /api/billing/ad-free/entitlements/:userId/grant — admin. Support tooling. */
export const grant = asyncHandler(async (req, res) => {
  const user = await findUser(req.params.userId);
  const row = await grantEntitlement({
    userId: user._id,
    key: req.body.key,
    source: 'admin',
    durationDays: req.body.durationDays ?? null,
    grantedBy: req.user._id,
  });
  await AuditLog.create({
    actor: req.user._id,
    action: 'ENTITLEMENT_GRANT',
    targetId: user._id,
    targetType: 'StudentEntitlement',
    metadata: { key: req.body.key, durationDays: req.body.durationDays ?? null },
  });
  res.status(201).json({ entitlement: row.toJSON() });
});

/** POST /api/billing/ad-free/entitlements/:userId/revoke — admin. */
export const revoke = asyncHandler(async (req, res) => {
  const user = await findUser(req.params.userId);
  const row = await revokeEntitlement({
    userId: user._id,
    key: req.body.key,
    reason: req.body.reason ?? 'admin_revoked',
  });
  if (!row) throw new AppError(404, 'ENTITLEMENT_NOT_FOUND', 'That student does not hold this entitlement.');
  await AuditLog.create({
    actor: req.user._id,
    action: 'ENTITLEMENT_REVOKE',
    targetId: user._id,
    targetType: 'StudentEntitlement',
    metadata: { key: req.body.key, reason: req.body.reason ?? 'admin_revoked' },
  });
  res.json({ entitlement: row.toJSON() });
});
