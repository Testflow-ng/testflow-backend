import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { Subscription } from '../models/Subscription.js';
import { SubscriptionPayment } from '../models/SubscriptionPayment.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { Organization } from '../models/Organization.js';
import { OrgExam } from '../models/OrgExam.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { recordAction } from './audit.service.js';
import { entitlementsFor } from './entitlements.js';
import { sendPlanChangeEmail } from './email.service.js';
import {
  orgPaystackConfigured,
  initializeOrgTransaction,
  verifyOrgTransaction,
  fetchOrgTransaction,
  normalizePaystackTransferInstructions,
} from './orgPaystack.service.js';

/**
 * Plan checkout, upgrades and renewals.
 *
 * Prices come from `PlanDefinition`, never the request. An upgrade charges only the prorated
 * difference for the days left in the current period; a downgrade is scheduled for the period end
 * and charges nothing now. A payment activates the subscription only after the provider confirms
 * it, and re-verifying or re-delivering the webhook never extends the pass twice.
 */

const PLAN_RANK = Object.freeze({ free: 0, pro: 1, studio: 2 });
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

const referenceFor = () => `SUB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

const requireProvider = () => {
  if (!orgPaystackConfigured()) {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  }
};

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
    displayText: src.displayText ?? null,
    transferReference: src.transferReference ?? null,
    channel: src.channel ?? null,
  };
  return Object.values(view).some((v) => v != null) ? view : null;
};

export const paymentView = (payment) => {
  const method = payment.paymentMethod ?? (payment.transferInstructions ? 'paystack_bank_transfer' : 'paystack_checkout');
  return {
    id: String(payment._id),
    reference: payment.reference,
    kind: payment.kind,
    planKey: payment.planKey,
    amountKobo: payment.amountKobo,
    currency: payment.currency,
    status: payment.status,
    paymentMethod: method,
    provider: payment.provider ?? null,
    authorizationUrl: payment.authorizationUrl ?? null,
    transferInstructions: transferView(payment.transferInstructions),
    providerChannel: payment.providerChannel ?? null,
    paidAt: payment.paidAt ?? null,
    verifiedAt: payment.verifiedAt ?? null,
  };
};

const planOrThrow = async (planKey) => {
  const plan = await PlanDefinition.findOne({ key: planKey, available: { $ne: false } }).lean();
  if (!plan) throw new AppError(400, 'PLAN_UNAVAILABLE', `Plan "${planKey}" is not available.`);
  return plan;
};

const proratedAmount = (sub, targetPlan) => {
  const currentPrice = Number(sub.planSnapshot?.priceMinor ?? 0);
  if (sub.status !== 'active' || !sub.currentPeriodEnd) return targetPlan.priceMinor;
  const remainingMs = new Date(sub.currentPeriodEnd).getTime() - Date.now();
  if (remainingMs <= 0) return targetPlan.priceMinor;
  const daysLeft = remainingMs / (24 * 60 * 60 * 1000);
  const difference = Math.round(((targetPlan.priceMinor - currentPrice) * daysLeft) / 30);
  return Math.max(0, difference);
};

const checkoutShape = (payment) => ({
  paymentId: String(payment._id),
  reference: payment.reference,
  amountKobo: payment.amountKobo,
  currency: payment.currency,
  authorizationUrl: payment.authorizationUrl ?? null,
  paymentMethod: payment.paymentMethod ?? 'paystack_checkout',
  transferInstructions: transferView(payment.transferInstructions),
  payment: paymentView(payment),
});

const applyProviderInit = (payment, initialized) => {
  if (!initialized) return;
  if (initialized.authorizationUrl != null) payment.authorizationUrl = initialized.authorizationUrl;
  if (initialized.transferInstructions) payment.transferInstructions = initialized.transferInstructions;
  if (initialized.channel) payment.providerChannel = initialized.channel;
  if (initialized.transactionId) payment.providerTransactionId = initialized.transactionId;
  if (initialized.reference && !payment.reference) payment.reference = initialized.reference;
};

/**
 * Create a provider checkout for `sub`. Reusing the idempotency key returns the first payment.
 * For an existing initialized payment, this never creates a duplicate provider transaction: it
 * returns the stored pending payment (and may refresh missing transfer instructions) so refreshes
 * and retries are safe.
 */
const startCheckout = async ({ org, user, sub, planKey, kind, amountKobo, idempotencyKey, paymentMethod = 'paystack_bank_transfer' }) => {
  const plan = await planOrThrow(planKey);
  if (idempotencyKey) {
    const existing = await SubscriptionPayment.findOne({ organization: org._id, idempotencyKey });
    if (existing) {
      if (String(existing.subscription) !== String(sub._id)) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That payment reference belongs to another subscription.');
      }
      // Idempotent recovery: pending/paid/failed outcomes are returned, never re-initialized.
      return { ...checkoutShape(existing), reused: true, status: existing.status };
    }
  }
  requireProvider();

  // Native bank transfer is the default for subscription payments. Keep checkout redirect support
  // only as an explicit compatibility path; student paid-exam flows still use checkout redirect.
  const useBankTransfer = paymentMethod === 'paystack_bank_transfer';
  const payment = await SubscriptionPayment.create({
    reference: referenceFor(),
    organization: org._id,
    subscription: sub._id,
    kind,
    planKey,
    amountKobo,
    currency: plan.currency ?? 'NGN',
    status: 'initialized',
    provider: 'paystack',
    paymentMethod: useBankTransfer ? 'paystack_bank_transfer' : 'paystack_checkout',
    // Omit the key entirely when absent: a unique+sparse index still indexes an explicit null, so
    // two keyless checkouts would collide.
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  const callbackUrl = `${config.CLIENT_URL}/workspace/billing/complete`;
  let initialized;
  try {
    initialized = await initializeOrgTransaction({
      reference: payment.reference,
      email: user.email,
      amountKobo: payment.amountKobo,
      currency: payment.currency,
      callbackUrl,
      ...(useBankTransfer ? { channels: ['bank_transfer'] } : {}),
      metadata: {
        kind: 'subscription',
        paymentMethod: payment.paymentMethod,
        organizationId: String(org._id),
        subscriptionId: String(sub._id),
        planKey,
      },
    });
  } catch (error) {
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed' } });
    throw error;
  }
  applyProviderInit(payment, initialized);
  await payment.save();
  return { ...checkoutShape(payment), reused: false, status: payment.status };
};

export const startSubscriptionCheckout = async ({ org, user, sub, paymentMethod, idempotencyKey }) => {
  if (sub.planKey === 'free') throw new AppError(422, 'PLAN_UNAVAILABLE', 'The Free plan has nothing to check out.');
  const plan = await planOrThrow(sub.planKey);
  return startCheckout({ org, user, sub, planKey: plan.key, kind: 'renewal', amountKobo: plan.priceMinor, idempotencyKey, paymentMethod });
};

export const upgradeSubscription = async ({ org, user, sub, planKey, idempotencyKey, paymentMethod }) => {
  const target = await planOrThrow(planKey);
  if (target.key === sub.planKey) return { noop: true };

  if (PLAN_RANK[target.key] <= PLAN_RANK[sub.planKey]) {
    // A downgrade is scheduled, not charged: access continues until the current period ends.
    sub.pendingPlanKey = target.key;
    await sub.save();
    return { downgrade: true };
  }

  const amountKobo = proratedAmount(sub, target);
  return startCheckout({ org, user, sub, planKey: target.key, kind: 'upgrade', amountKobo, idempotencyKey, paymentMethod });
};

export const renewSubscription = async ({ org, user, sub, idempotencyKey, paymentMethod }) => {
  if (sub.planKey === 'free') throw new AppError(422, 'PLAN_UNAVAILABLE', 'The Free plan has nothing to renew.');
  const plan = await planOrThrow(sub.planKey);
  return startCheckout({ org, user, sub, planKey: plan.key, kind: 'renewal', amountKobo: plan.priceMinor, idempotencyKey, paymentMethod });
};

const cancelOtherActive = (organizationId, keepId) =>
  Subscription.updateMany(
    { organization: organizationId, _id: { $ne: keepId }, status: 'active' },
    { $set: { status: 'cancelled' } },
  );

const activate = async (payment) => {
  const plan = await planOrThrow(payment.planKey);
  const sub = await Subscription.findById(payment.subscription);
  if (!sub) throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  const now = new Date();
  const isRenewalAfterActive =
    payment.kind === 'renewal' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > now.getTime();
  const endsAt = isRenewalAfterActive
    ? new Date(new Date(sub.currentPeriodEnd).getTime() + PERIOD_MS)
    : new Date(now.getTime() + PERIOD_MS);

  sub.planKey = plan.key;
  sub.status = 'active';
  sub.planSnapshot = {
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    entitlements: plan.entitlements,
  };
  sub.currentPeriodStart = now;
  sub.currentPeriodEnd = endsAt;
  sub.pendingPlanKey = undefined;
  sub.provider = 'paystack';
  sub.providerReference = payment.reference;
  sub.lastPaymentId = String(payment._id);
  await sub.save();
  await cancelOtherActive(payment.organization, sub._id);
  return sub;
};

const settlePaid = async (payment, { amountKobo, currency, paidAt, transferInstructions, channel, transactionId }) => {
  if (Number(amountKobo) !== Number(payment.amountKobo) || String(currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
    payment.status = 'failed';
    await payment.save();
    throw new AppError(409, 'PAYMENT_MISMATCH', 'The amount or currency confirmed by the provider does not match this payment.');
  }
  const claimed = await SubscriptionPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['initialized', 'failed'] } },
    {
      $set: {
        status: 'paid',
        paidAt: paidAt ?? new Date(),
        verifiedAt: new Date(),
        ...(transferInstructions ? { transferInstructions } : {}),
        ...(channel ? { providerChannel: channel } : {}),
        ...(transactionId ? { providerTransactionId: String(transactionId) } : {}),
      },
    },
    { new: true },
  );
  if (!claimed) {
    const current = await SubscriptionPayment.findById(payment._id);
    const sub = await Subscription.findById(payment.subscription);
    return { status: 'paid', duplicate: true, payment: current, subscription: sub };
  }
  const sub = await activate(claimed);
  return { status: 'paid', duplicate: false, payment: claimed, subscription: sub };
};

/** Membership gate for a payment reference: only owner or admin of the paying org. */
export const assertPaymentAccess = async (userId, payment) => {
  const membership = await OrgMembership.findOne({
    organization: payment.organization,
    user: userId,
    role: { $in: ['owner', 'admin'] },
    status: 'active',
  }).lean();
  if (!membership) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
};

export const verifySubscriptionPayment = async (userId, reference) => {
  const result = await getSubscriptionPaymentStatus(userId, { reference, refresh: true });
  // Preserve historical verify shape while including normalized payment.
  return result;
};

/** HMAC over the exact bytes, using the project's Paystack secret. */
const signatureValid = (rawBody, signature) => {
  if (!rawBody || !signature || !config.PAYSTACK_SECRET_KEY) return false;
  const expected = crypto.createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const handleSubscriptionWebhook = async (rawBody, signature, body) => {
  if (!signatureValid(rawBody, signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid payment signature.');
  }
  const type = body?.event;
  const reference = body?.data?.reference;
  const eventId = body?.data?.id != null ? String(body.data.id) : null;
  if (!type || !reference) return { ignored: true };

  const payment = await SubscriptionPayment.findOne({ reference });
  if (!payment) return { ignored: true };
  if (eventId && payment.processedEventIds?.includes(eventId)) {
    return { handled: true, duplicate: true, status: payment.status };
  }

  // Persist any provider transfer details present on webhook payloads without activating.
  const transferInstructions = body?.data ? normalizePaystackTransferInstructions(body.data) : null;
  if (transferInstructions || body?.data?.channel) {
    const set = {};
    if (transferInstructions && !payment.transferInstructions) set.transferInstructions = transferInstructions;
    if (body?.data?.channel) set.providerChannel = String(body.data.channel);
    if (eventId) set.processedEventIds = Array.from(new Set([...(payment.processedEventIds || []), eventId]));
    if (Object.keys(set).length) await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: set });
  } else if (eventId) {
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $addToSet: { processedEventIds: eventId } });
  }

  if (type === 'charge.failed') {
    if (payment.status === 'initialized') {
      payment.status = 'failed';
      await payment.save();
    }
    return { handled: true, status: payment.status };
  }
  if (type === 'refund.processed' || type === 'refund.success') {
    if (payment.status === 'paid') {
      payment.status = 'refunded';
      await payment.save();
    }
    return { handled: true, status: payment.status };
  }
  // Bank transfer payments settle through charge.success. "I have paid" client claims must never
  // activate; only provider-confirmed success reaches settlePaid.
  if (type !== 'charge.success') return { ignored: true };

  const result = await settlePaid(payment, {
    amountKobo: body.data.amount,
    currency: body.data.currency,
    paidAt: body.data.paid_at ? new Date(body.data.paid_at) : new Date(),
    transferInstructions,
    channel: body?.data?.channel,
    transactionId: body?.data?.id,
  });
  return { handled: true, duplicate: result.duplicate, status: result.status };
};


const assertPaymentInOrg = (payment, orgId) => {
  if (String(payment.organization) !== String(orgId)) {
    throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
  }
};

/**
 * Status/refresh for a subscription payment. Safe to poll/refresh: returns the stored state,
 * optionally re-checking the provider for initialized payments and persisting any newly available
 * transfer instructions without creating a duplicate transaction.
 */
export const getSubscriptionPaymentStatus = async (userId, { orgId, reference, refresh = true }) => {
  const payment = await SubscriptionPayment.findOne({ reference });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'That payment does not exist.');
  await assertPaymentAccess(userId, payment);
  if (orgId) assertPaymentInOrg(payment, orgId);

  if (payment.status === 'paid') {
    const sub = await Subscription.findById(payment.subscription);
    return { status: 'paid', duplicate: true, payment, subscription: sub, refreshed: false };
  }
  if (payment.status === 'failed' || payment.status === 'refunded' || payment.status === 'abandoned') {
    const sub = await Subscription.findById(payment.subscription);
    return { status: payment.status, payment, subscription: sub, refreshed: false };
  }

  if (!refresh) {
    const sub = await Subscription.findById(payment.subscription);
    return { status: 'pending', payment, subscription: sub, refreshed: false };
  }

  requireProvider();
  const provider = await (fetchOrgTransaction ? fetchOrgTransaction(reference) : verifyOrgTransaction(reference));
  if (provider.transferInstructions && !payment.transferInstructions) payment.transferInstructions = provider.transferInstructions;
  if (provider.channel) payment.providerChannel = provider.channel;
  if (provider.transactionId) payment.providerTransactionId = provider.transactionId;
  if (payment.isModified()) await payment.save();

  if (provider.status === 'success') {
    return { ...(await settlePaid(payment, provider)), refreshed: true };
  }
  if (provider.status === 'failed') {
    payment.status = 'failed';
    await payment.save();
    const sub = await Subscription.findById(payment.subscription);
    return { status: 'failed', payment, subscription: sub, refreshed: true };
  }
  const sub = await Subscription.findById(payment.subscription);
  return { status: 'pending', payment, subscription: sub, refreshed: true, providerStatus: provider.rawStatus ?? null };
};

/** Checkout recovery by payment reference (org-scoped). Never creates a new provider transaction. */
export const getCheckoutByReference = async (userId, { orgId, reference }) => {
  const payment = await SubscriptionPayment.findOne({ reference });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'That payment does not exist.');
  await assertPaymentAccess(userId, payment);
  if (orgId) assertPaymentInOrg(payment, orgId);
  return { ...checkoutShape(payment), status: payment.status, reused: true };
};

/* -------------------------------------------------- plan transitions (cron) */

/**
 * Apply every downgrade whose period has ended. The subscription stays `active` (so the org keeps
 * the plan it paid for until the last day) but carries the new plan from that morning onward.
 */
export const applyScheduledDowngrades = async (now = new Date()) => {
  const due = await Subscription.find({
    status: 'active',
    pendingPlanKey: { $ne: null },
    currentPeriodEnd: { $lte: now },
  });
  const touched = [];
  for (const sub of due) {
    const plan = await PlanDefinition.findOne({ key: sub.pendingPlanKey }).lean();
    const applied = sub.pendingPlanKey;
    sub.planKey = applied;
    sub.pendingPlanKey = undefined;
    if (plan) {
      sub.planSnapshot = {
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        entitlements: plan.entitlements,
      };
    }
    await sub.save();
    touched.push(String(sub.organization));
    await recordAction({
      actorId: 'system',
      action: 'SUBSCRIPTION_DOWNGRADE_APPLIED',
      targetType: 'Organization',
      targetId: sub.organization,
      metadata: { planKey: applied },
    });
  }
  return touched;
};

const PLAN_NAMES = { free: 'Free', pro: 'Pro', studio: 'Studio' };

/**
 * Unpublish what a downgraded plan no longer allows, then tell the organiser.
 *
 * Nothing is deleted: a live exam that has not started becomes a draft it can publish again after
 * an upgrade, and a paid exam becomes a draft so no new student is charged for it. Money already
 * earned and sittings already in progress are untouched.
 */
export const enforcePlanForOrgs = async (orgIds) => {
  const unique = [...new Set((orgIds ?? []).map(String).filter(Boolean))];
  const summary = { orgs: 0, liveUnpublished: 0, paidUnpublished: 0 };
  const now = new Date();
  for (const orgId of unique) {
    const ent = await entitlementsFor(orgId);
    let live = 0;
    let paid = 0;
    if (!ent.liveCbt) {
      const res = await OrgExam.updateMany(
        { organization: orgId, mode: 'live', status: 'published', startsAt: { $gt: now } },
        { $set: { status: 'draft' } },
      );
      live = res.modifiedCount;
    }
    if (!ent.paidExams) {
      const res = await OrgExam.updateMany(
        { organization: orgId, status: 'published', priceMinor: { $gt: 0 } },
        { $set: { status: 'draft' } },
      );
      paid = res.modifiedCount;
    }
    if (!live && !paid) continue;
    summary.orgs += 1;
    summary.liveUnpublished += live;
    summary.paidUnpublished += paid;

    const org = await Organization.findById(orgId).select('name ownerUser contactEmail').lean();
    const owner = org?.ownerUser
      ? await User.findById(org.ownerUser).select('email fullName').lean()
      : null;
    const to = org?.contactEmail || owner?.email;
    if (to) {
      await sendPlanChangeEmail({
        to,
        name: owner?.fullName ?? org?.name ?? 'there',
        orgName: org?.name ?? 'your organisation',
        planName: PLAN_NAMES[ent.planKey] ?? 'Free',
        liveUnpublished: live,
        paidUnpublished: paid,
      }).catch(() => {});
    }
    await recordAction({
      actorId: 'system',
      action: 'ORG_PLAN_ENFORCED',
      targetType: 'Organization',
      targetId: orgId,
      metadata: { planKey: ent.planKey, liveUnpublished: live, paidUnpublished: paid },
    });
  }
  return summary;
};
