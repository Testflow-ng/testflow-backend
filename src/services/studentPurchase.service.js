import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { AuditLog } from '../models/AuditLog.js';
import { StudentPurchase } from '../models/StudentPurchase.js';
import { StudentEntitlement } from '../models/StudentEntitlement.js';
import { findStudentPlan } from '../config/plans.js';
import { getProvider } from './ads/payment/index.js';
import { grantEntitlement, revokeEntitlement, studentEntitlements } from './studentPlan.service.js';

/**
 * The student purchase flow: initialize a payment for a plan, verify it, and activate the
 * entitlement it pays for.
 *
 * Two rules drive the whole file:
 *  1. A price is never taken from the request. The catalogue prices it, the purchase record stores
 *     it, and the provider's answer is compared against the stored number before anything is
 *     granted.
 *  2. Nothing is granted until the provider has verified the transaction. A webhook body is a
 *     receipt to re-verify, not a payment.
 */

export const REFERENCE_PREFIX = 'TFS-';

/** The shared Paystack adapter (`services/ads/payment`) is the project's one payment integration. */
const providerOrNull = () => getProvider();

const makeReference = () => `${REFERENCE_PREFIX}${crypto.randomBytes(12).toString('hex')}`;

export const toPurchaseView = (purchase) => ({
  id: String(purchase._id),
  reference: purchase.reference,
  planKey: purchase.planKey,
  planName: purchase.planSnapshot?.name ?? null,
  amountKobo: purchase.amountKobo,
  currency: purchase.currency,
  status: purchase.status,
  provider: purchase.provider,
  authorizationUrl: purchase.status === 'initialized' ? purchase.authorizationUrl ?? null : null,
  paidAt: purchase.paidAt ?? null,
  verifiedAt: purchase.verifiedAt ?? null,
  refundedAt: purchase.refundedAt ?? null,
  createdAt: purchase.createdAt,
});

/** Idempotent lookup for the checkout retry the client is allowed to make. */
const findByIdempotencyKey = async (userId, idempotencyKey) => {
  if (!idempotencyKey) return null;
  return StudentPurchase.findOne({ user: userId, idempotencyKey });
};

/**
 * POST /api/billing/ad-free/checkout
 * Creates a pending purchase and, when a provider is configured, an authorization URL.
 * A duplicate `idempotencyKey` returns the original purchase instead of charging twice.
 */
export const startCheckout = async ({ user, planKey, idempotencyKey = null }) => {
  const plan = findStudentPlan(planKey);
  if (!plan || !plan.available) {
    throw new AppError(404, 'PLAN_NOT_FOUND', 'That plan is not available.');
  }

  const replay = await findByIdempotencyKey(user._id, idempotencyKey);
  if (replay) return { purchase: replay, replay: true };

  // Same contract as the other checkout flows: refuse before writing anything.
  const provider = providerOrNull();
  if (!provider) {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  }

  const reference = makeReference();

  const purchase = await StudentPurchase.create({
    reference,
    user: user._id,
    planKey: plan.key,
    planSnapshot: {
      name: plan.name,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      durationDays: plan.durationDays,
      entitlementKeys: Object.keys(plan.entitlements).filter((k) => plan.entitlements[k]),
    },
    amountKobo: plan.priceMinor,
    currency: plan.currency,
    status: 'initialized',
    provider: provider.name,
    idempotencyKey: idempotencyKey ?? undefined,
  });

  const callbackUrl = config.AD_FREE_CALLBACK_URL ?? `${config.CLIENT_URL.replace(/\/$/, '')}/billing/complete`;
  try {
    const { authorizationUrl } = await provider.initialize({
      reference,
      email: user.email,
      amountKobo: purchase.amountKobo,
      currency: purchase.currency,
      callbackUrl,
      // Nothing personal beyond the product and the plan.
      metadata: { product: 'testflow', kind: 'student_plan', planKey: plan.key, userId: String(user._id) },
    });
    purchase.authorizationUrl = authorizationUrl;
    await purchase.save();
  } catch (error) {
    purchase.status = 'failed';
    await purchase.save();
    logger.error('[ad-free] provider initialize failed', error);
    throw new AppError(502, 'PAYMENT_INIT_FAILED', 'Could not start the payment. Please try again.');
  }

  return { purchase, replay: false };
};

const mismatch = (purchase, payment) => ({
  expectedAmountKobo: purchase.amountKobo,
  actualAmountKobo: payment.amountKobo ?? null,
  expectedCurrency: purchase.currency,
  actualCurrency: payment.currency ?? null,
});

/**
 * Apply a verified successful payment exactly once. Returns the purchase either way.
 * `now` is injectable so expiry tests do not have to travel in time.
 */
export const applyVerifiedPayment = async ({ purchase, payment, now = new Date() }) => {
  if (purchase.status === 'paid') return purchase; // already applied, never re-grant

  if (payment.status !== 'success') {
    purchase.status = payment.status === 'pending' ? 'initialized' : 'failed';
    purchase.verifiedAt = now;
    await purchase.save();
    return purchase;
  }

  if (Number(payment.amountKobo) !== Number(purchase.amountKobo) || String(payment.currency).toUpperCase() !== String(purchase.currency).toUpperCase()) {
    purchase.status = 'failed';
    purchase.mismatch = mismatch(purchase, payment);
    purchase.verifiedAt = now;
    await purchase.save();
    throw new AppError(409, 'PAYMENT_MISMATCH', 'The payment does not match this purchase.');
  }

  purchase.status = 'paid';
  purchase.paidAt = payment.paidAt ?? now;
  purchase.providerTransactionId = payment.transactionId ?? purchase.providerTransactionId;
  purchase.verifiedAt = now;
  purchase.mismatch = null;
  await purchase.save();

  for (const key of purchase.planSnapshot.entitlementKeys) {
    await grantEntitlement({
      userId: purchase.user,
      key,
      source: 'purchase',
      planKey: purchase.planKey,
      purchaseId: purchase._id,
      durationDays: purchase.planSnapshot.durationDays,
      now,
    });
  }

  await AuditLog.create({
    actor: purchase.user,
    action: 'AD_FREE_PURCHASE_VERIFIED',
    targetId: purchase._id,
    targetType: 'StudentPurchase',
    metadata: { reference: purchase.reference, planKey: purchase.planKey, amountKobo: purchase.amountKobo, currency: purchase.currency },
  });

  return purchase;
};

/**
 * GET /api/billing/ad-free/status?reference=
 * Without a reference this is just the entitlement read. With one, an unpaid purchase is
 * re-verified against the provider, which is how the client learns the outcome if the webhook is
 * not reachable (local development, provider hiccup).
 */
export const getStatus = async ({ user, reference = null, now = new Date() }) => {
  const entitlements = await studentEntitlements(user._id, { now });

  if (!reference) {
    return { entitlements, purchase: null };
  }

  const purchase = await StudentPurchase.findOne({ reference, user: user._id });
  if (!purchase) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found.');

  const provider = providerOrNull();
  if (purchase.status === 'initialized' && purchase.provider === 'paystack' && provider) {
    const payment = await provider.verify(reference);
    await applyVerifiedPayment({ purchase, payment, now });
  }

  return { entitlements: await studentEntitlements(user._id, { now }), purchase };
};

/** Students may abandon their own pending purchase; a paid one is a refund decision, not a cancel. */
export const cancelPurchase = async ({ user, reference }) => {
  const purchase = await StudentPurchase.findOne({ reference, user: user._id });
  if (!purchase) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found.');
  if (purchase.status === 'initialized') {
    purchase.status = 'abandoned';
    await purchase.save();
  }
  return purchase;
};

/**
 * Administrator refund. Reverses the charge with the provider, then revokes the entitlement that
 * payment bought. Only the entitlement this purchase granted is touched.
 */
export const refundPurchase = async ({ actor, reference, reason = 'refund' }) => {
  const purchase = await StudentPurchase.findOne({ reference });
  if (!purchase) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found.');
  if (purchase.status !== 'paid') {
    throw new AppError(409, 'PURCHASE_NOT_REFUNDABLE', 'Only a paid purchase can be refunded.');
  }

  const provider = providerOrNull();
  if (!provider) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');

  const result = await provider.refund({ reference, amountKobo: purchase.amountKobo });
  purchase.status = 'refunded';
  purchase.refundedAt = new Date();
  purchase.refundId = result?.refundId ?? null;
  purchase.revokedReason = reason;
  await purchase.save();

  await revokePurchaseEntitlements(purchase, reason);

  await AuditLog.create({
    actor: actor?._id ?? null,
    action: 'AD_FREE_REFUND',
    targetId: purchase._id,
    targetType: 'StudentPurchase',
    metadata: { reference, reason },
  });

  return purchase;
};

/**
 * Revokes exactly the keys this purchase granted, and only while it is the grant holder: a later
 * purchase that stacked on top keeps its entitlement.
 */
export const revokePurchaseEntitlements = async (purchase, reason) => {
  for (const key of purchase.planSnapshot.entitlementKeys) {
    const row = await StudentEntitlement.findOne({ user: purchase.user, key }).lean();
    if (!row) continue;
    if (row.purchase && String(row.purchase) !== String(purchase._id)) continue; // superseded by a newer pass
    await revokeEntitlement({ userId: purchase.user, key, reason });
  }
};

/**
 * POST /api/billing/ad-free/webhook  (Paystack)
 * Signature over the raw bytes, then the reference prefix decides ownership: anything that is not
 * ours is acknowledged and ignored so another dispatcher can handle it.
 */
export const handleWebhook = async ({ rawBody, signature, body, now = new Date() }) => {
  const provider = providerOrNull();
  if (!provider) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');

  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
  }

  const parsed = provider.parseWebhook(body);
  if (!parsed?.reference) throw new AppError(400, 'INVALID_WEBHOOK', 'Unrecognized webhook payload.');
  if (!String(parsed.reference).startsWith(REFERENCE_PREFIX)) {
    return { ignored: true, reference: parsed.reference };
  }

  const purchase = await StudentPurchase.findOne({ reference: parsed.reference });
  if (!purchase) return { ignored: true, reference: parsed.reference };

  const eventId = `${parsed.type}:${parsed.reference}`;
  // Claim the event first; a redelivery loses the race and is a no-op.
  const claimed = await StudentPurchase.findOneAndUpdate(
    { _id: purchase._id, processedEventIds: { $ne: eventId } },
    { $addToSet: { processedEventIds: eventId } },
    { new: true },
  );
  if (!claimed) return { duplicate: true, reference: parsed.reference };

  try {
    if (parsed.type === 'refund.processed') {
      claimed.status = 'refunded';
      claimed.refundedAt = now;
      claimed.revokedReason = 'refund';
      await claimed.save();
      await revokePurchaseEntitlements(claimed, 'refund');
      return { refunded: true, reference: claimed.reference };
    }

    // Never trust the webhook amount: re-verify with the provider before granting anything.
    const payment = await provider.verify(claimed.reference);
    await applyVerifiedPayment({ purchase: claimed, payment, now });
    return { applied: true, status: claimed.status, reference: claimed.reference };
  } catch (error) {
    // Release the claim so a provider retry can attempt it again.
    await StudentPurchase.updateOne({ _id: claimed._id }, { $pull: { processedEventIds: eventId } });
    throw error;
  }
};

export const listPurchases = async (userId) => StudentPurchase.find({ user: userId }).sort({ createdAt: -1 }).limit(50);
