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

export const paymentView = (payment) => ({
  id: String(payment._id),
  reference: payment.reference,
  kind: payment.kind,
  planKey: payment.planKey,
  amountKobo: payment.amountKobo,
  currency: payment.currency,
  status: payment.status,
  authorizationUrl: payment.authorizationUrl ?? null,
  paidAt: payment.paidAt ?? null,
});

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
  authorizationUrl: payment.authorizationUrl,
});

/** Create a provider checkout for `sub`. Reusing the idempotency key returns the first payment. */
const startCheckout = async ({ org, user, sub, planKey, kind, amountKobo, idempotencyKey }) => {
  const plan = await planOrThrow(planKey);
  if (idempotencyKey) {
    const existing = await SubscriptionPayment.findOne({ organization: org._id, idempotencyKey }).lean();
    if (existing) {
      if (String(existing.subscription) !== String(sub._id)) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That payment reference belongs to another subscription.');
      }
      return { ...checkoutShape(existing), reused: true };
    }
  }
  requireProvider();

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
      metadata: {
        kind: 'subscription',
        organizationId: String(org._id),
        subscriptionId: String(sub._id),
        planKey,
      },
    });
  } catch (error) {
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed' } });
    throw error;
  }
  payment.authorizationUrl = initialized.authorizationUrl;
  await payment.save();
  return { ...checkoutShape(payment), reused: false };
};

export const upgradeSubscription = async ({ org, user, sub, planKey, idempotencyKey }) => {
  const target = await planOrThrow(planKey);
  if (target.key === sub.planKey) return { noop: true };

  if (PLAN_RANK[target.key] <= PLAN_RANK[sub.planKey]) {
    // A downgrade is scheduled, not charged: access continues until the current period ends.
    sub.pendingPlanKey = target.key;
    await sub.save();
    return { downgrade: true };
  }

  const amountKobo = proratedAmount(sub, target);
  return startCheckout({ org, user, sub, planKey: target.key, kind: 'upgrade', amountKobo, idempotencyKey });
};

export const renewSubscription = async ({ org, user, sub, idempotencyKey }) => {
  if (sub.planKey === 'free') throw new AppError(422, 'PLAN_UNAVAILABLE', 'The Free plan has nothing to renew.');
  const plan = await planOrThrow(sub.planKey);
  return startCheckout({ org, user, sub, planKey: plan.key, kind: 'renewal', amountKobo: plan.priceMinor, idempotencyKey });
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

const settlePaid = async (payment, { amountKobo, currency, paidAt }) => {
  if (Number(amountKobo) !== Number(payment.amountKobo) || String(currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
    payment.status = 'failed';
    await payment.save();
    throw new AppError(409, 'PAYMENT_MISMATCH', 'The amount or currency confirmed by the provider does not match this payment.');
  }
  const claimed = await SubscriptionPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['initialized', 'failed'] } },
    { $set: { status: 'paid', paidAt: paidAt ?? new Date(), verifiedAt: new Date() } },
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
  const payment = await SubscriptionPayment.findOne({ reference });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'That payment does not exist.');
  await assertPaymentAccess(userId, payment);

  const sub = await Subscription.findById(payment.subscription);
  if (payment.status === 'paid') return { status: 'paid', duplicate: true, payment, subscription: sub };
  if (payment.status === 'failed' || payment.status === 'refunded' || payment.status === 'abandoned') {
    return { status: payment.status, payment, subscription: sub };
  }

  requireProvider();
  const verified = await verifyOrgTransaction(reference);
  if (verified.status !== 'success') {
    if (verified.status === 'failed') {
      payment.status = 'failed';
      await payment.save();
      return { status: 'failed', payment, subscription: sub };
    }
    return { status: 'pending', payment, subscription: sub };
  }
  return settlePaid(payment, verified);
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
  if (!type || !reference) return { ignored: true };

  const payment = await SubscriptionPayment.findOne({ reference });
  if (!payment) return { ignored: true };

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
  if (type !== 'charge.success') return { ignored: true };

  const result = await settlePaid(payment, {
    amountKobo: body.data.amount,
    currency: body.data.currency,
    paidAt: body.data.paid_at ? new Date(body.data.paid_at) : new Date(),
  });
  return { handled: true, duplicate: result.duplicate, status: result.status };
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
