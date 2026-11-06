import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { AuditLog } from '../models/AuditLog.js';
import { StudentPurchase } from '../models/StudentPurchase.js';
import { StudentEntitlement } from '../models/StudentEntitlement.js';
import { User } from '../models/User.js';
import { findStudentPlan } from '../config/plans.js';
import { getProvider } from './ads/payment/index.js';
import { normalizePaystackTransferInstructions } from './orgPaystack.service.js';
import { grantEntitlement, revokeEntitlement, studentEntitlements } from './studentPlan.service.js';
import { sendStudentPaymentSuccessEmail } from './email.service.js';

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
export const PENDING_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes session timeout

/** The shared Paystack adapter (`services/ads/payment`) is the project's one payment integration. */
const providerOrNull = () => getProvider();

const makeReference = () => `${REFERENCE_PREFIX}${crypto.randomBytes(12).toString('hex')}`;

const transferView = (instructions) => {
  if (!instructions) return null;
  const src = typeof instructions.toObject === 'function' ? instructions.toObject() : instructions;
  const view = {
    bankName: src.bankName ?? null,
    accountName: src.accountName ?? null,
    accountNumber: src.accountNumber ?? null,
    amountKobo: src.amountKobo ?? null,
    currency: src.currency ?? null,
    expiresAt: src.expiresAt ?? null,
    transferReference: src.transferReference ?? null,
    displayText: src.displayText ?? null,
    channel: src.channel ?? null,
  };
  return Object.values(view).some((v) => v != null) ? view : null;
};

export const toPurchaseView = (purchase) => {
  const isExpired =
    purchase.status === 'initialized' &&
    purchase.createdAt &&
    Date.now() - new Date(purchase.createdAt).getTime() > PENDING_TIMEOUT_MS;
  const status = isExpired ? 'abandoned' : purchase.status;
  const paymentMethod = purchase.paymentMethod ?? (purchase.transferInstructions ? 'paystack_bank_transfer' : 'paystack_checkout');

  return {
    id: String(purchase._id),
    reference: purchase.reference,
    planKey: purchase.planKey,
    planName: purchase.planSnapshot?.name ?? null,
    amountKobo: purchase.amountKobo,
    currency: purchase.currency,
    status,
    // Frontend-facing normalized semantics (backward compatible: maps to same lifecycle values).
    paymentState: status === 'initialized' ? (paymentMethod === 'paystack_bank_transfer' ? 'awaiting_transfer' : 'initializing') : status,
    provider: purchase.provider,
    paymentMethod,
    authorizationUrl: status === 'initialized' ? purchase.authorizationUrl ?? null : null,
    transferInstructions: status === 'initialized' || status === 'paid' ? transferView(purchase.transferInstructions) : null,
    providerChannel: purchase.providerChannel ?? null,
    paidAt: purchase.paidAt ?? null,
    verifiedAt: purchase.verifiedAt ?? null,
    refundedAt: purchase.refundedAt ?? null,
    createdAt: purchase.createdAt,
  };
};

/** Idempotent lookup for the checkout retry the client is allowed to make. */
const findByIdempotencyKey = async (userId, idempotencyKey) => {
  if (!idempotencyKey) return null;
  return StudentPurchase.findOne({ user: userId, idempotencyKey });
};

const applyInitResult = (purchase, init) => {
  if (!init) return;
  if (init.authorizationUrl != null) purchase.authorizationUrl = init.authorizationUrl;
  if (init.providerTransactionId) purchase.providerTransactionId = String(init.providerTransactionId);
  if (init.channel) purchase.providerChannel = String(init.channel);
  const instructions = init.transferInstructions ?? normalizePaystackTransferInstructions(init.raw ?? init);
  if (instructions) purchase.transferInstructions = instructions;
};

/**
 * POST /api/billing/ad-free/checkout
 * Creates/reuses a pending purchase. Defaults to native Paystack bank transfer for student plans
 * (Plus/pass_30d and any other available student plan). A duplicate `idempotencyKey` or an
 * existing initialized purchase for the same plan/key is returned instead of creating duplicates.
 * Refresh/status recovery never creates a new provider transaction.
 */
export const startCheckout = async ({ user, planKey, idempotencyKey = null, paymentMethod = 'paystack_bank_transfer' }) => {
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

  const useBankTransfer = paymentMethod === 'paystack_bank_transfer';
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
    paymentMethod: useBankTransfer ? 'paystack_bank_transfer' : 'paystack_checkout',
    idempotencyKey: idempotencyKey ?? undefined,
  });

  const callbackUrl = config.AD_FREE_CALLBACK_URL ?? `${config.CLIENT_URL.replace(/\/$/, '')}/billing/complete`;
  try {
    const init = await provider.initialize({
      reference,
      email: user.email,
      amountKobo: purchase.amountKobo,
      currency: purchase.currency,
      callbackUrl,
      ...(useBankTransfer ? { channels: ['bank_transfer'] } : {}),
      // Nothing personal beyond the product and the plan.
      metadata: { product: 'testflow', kind: 'student_plan', planKey: plan.key, userId: String(user._id), paymentMethod: purchase.paymentMethod },
    });
    applyInitResult(purchase, init);
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

  // Persist any provider-returned transfer/channel metadata without granting entitlements.
  const instructions = payment?.transferInstructions ?? normalizePaystackTransferInstructions(payment?.raw ?? payment);
  if (instructions && !purchase.transferInstructions) purchase.transferInstructions = instructions;
  if (payment?.channel) purchase.providerChannel = String(payment.channel);
  if (payment?.transactionId) purchase.providerTransactionId = String(payment.transactionId);

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

  // Send confirmation email asynchronously (never blocks the API response)
  User.findById(purchase.user)
    .then((user) => {
      if (user && user.email) {
        return sendStudentPaymentSuccessEmail({ user, purchase });
      }
    })
    .catch((err) => {
      logger.error('[payment-email] Failed to send receipt email:', err);
    });

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
export const getStatus = async ({ user, reference = null, refresh = true, now = new Date() }) => {
  const entitlements = await studentEntitlements(user._id, { now });

  if (!reference) {
    return { entitlements, purchase: null };
  }

  const purchase = await StudentPurchase.findOne({ reference, user: user._id });
  if (!purchase) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found.');

  const provider = providerOrNull();
  const shouldRefresh = refresh && purchase.status === 'initialized' && purchase.provider === 'paystack' && provider;
  if (shouldRefresh) {
    const payment = await (typeof provider.fetch === 'function' ? provider.fetch(reference) : provider.verify(reference));
    await applyVerifiedPayment({ purchase, payment, now });
  }

  return { entitlements: await studentEntitlements(user._id, { now }), purchase };
};

/** Safe checkout/purchase recovery by reference for the owning student. Never creates a new provider transaction. */
export const getPurchaseByReference = async ({ user, reference }) => {
  const purchase = await StudentPurchase.findOne({ reference, user: user._id });
  if (!purchase) throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found.');
  return purchase;
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
 *
 * Driven by both the snapshot and the rows themselves. The snapshot alone would miss a key the
 * purchase granted that was not in the catalogue when it was sold (a pass bought before the
 * `library` entitlement existed still granted it once the row was backfilled), so any row that
 * still names this purchase is revoked too.
 */
export const revokePurchaseEntitlements = async (purchase, reason) => {
  const granted = await StudentEntitlement.find({ user: purchase.user, purchase: purchase._id }).select('key').lean();
  const keys = new Set([...purchase.planSnapshot.entitlementKeys, ...granted.map((row) => row.key)]);

  for (const key of keys) {
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

export const listPurchases = async (userId) => {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
  await StudentPurchase.updateMany(
    { user: userId, status: 'initialized', createdAt: { $lt: cutoff } },
    { status: 'abandoned' },
  );
  return StudentPurchase.find({ user: userId }).sort({ createdAt: -1 }).limit(50);
};
