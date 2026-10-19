import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { Organization } from '../models/Organization.js';
import { OrgExam } from '../models/OrgExam.js';
import { OrgPayment } from '../models/OrgPayment.js';
import { AppError } from '../utils/AppError.js';
import { entitlementsFor } from './entitlements.js';
import { assertFeature } from './orgContent.service.js';
import { getPlatformPercent } from './orgMoney.service.js';
import {
  orgPaystackConfigured,
  initializeOrgTransaction,
  verifyOrgTransaction,
  refundOrgTransaction,
  verifyOrgWebhookSignature,
  parseOrgWebhook,
} from './orgPaystack.service.js';

/**
 * Student payments to an organisation.
 *
 * The price is read from the published exam, never from the request. Paystack is initialised with
 * the organiser's own subaccount, so the split happens at source; the four amounts are frozen onto
 * the payment row when it settles. A student gets access only after the provider has confirmed the
 * charge (the sitting service checks `status: 'paid'`), and a redelivered webhook is a no-op.
 */

const referenceFor = (orgId) =>
  `ORG-${String(orgId).slice(-6).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

const paymentView = (payment) => ({
  id: String(payment._id),
  reference: payment.reference,
  item: payment.item,
  itemRef: payment.itemRef ? String(payment.itemRef) : null,
  itemTitle: payment.itemTitle,
  currency: payment.currency,
  grossKobo: payment.grossKobo,
  platformPercent: payment.platformPercent,
  platformFeeKobo: payment.platformFeeKobo,
  orgShareKobo: payment.orgShareKobo,
  paystackFeeKobo: payment.paystackFeeKobo,
  status: payment.status,
  authorizationUrl: payment.authorizationUrl ?? null,
  paidAt: payment.paidAt ?? null,
  refundedAt: payment.refundedAt ?? null,
});

const requirePayout = (org) => {
  if (org?.payout?.status !== 'active' || !org?.payout?.subaccountCode) {
    throw new AppError(422, 'PAYOUT_REQUIRED', 'Add an active payout account before charging for exams.');
  }
};

const requireStudio = async (orgId) => {
  const ent = await entitlementsFor(orgId);
  assertFeature(ent, 'paid_exams');
  return ent;
};

const settle = async (payment, verified) => {
  if (payment.status === 'paid') return { payment, duplicate: true, access: true };
  if (payment.status === 'refunded' || payment.status === 'failed') {
    return { payment, duplicate: false, access: false };
  }
  if (verified.status !== 'success') {
    if (verified.status === 'failed') {
      payment.status = 'failed';
      payment.failureReason = 'provider_failed';
      await payment.save();
    }
    return { payment, duplicate: false, access: false };
  }

  if (Number(verified.amountKobo) !== Number(payment.grossKobo) || String(verified.currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
    payment.status = 'failed';
    payment.failureReason = 'amount_or_currency_mismatch';
    await payment.save();
    throw new AppError(409, 'PAYMENT_MISMATCH', 'The amount or currency confirmed by the provider does not match this payment.');
  }

  const percent = await getPlatformPercent();
  const platformFeeKobo = Math.round((payment.grossKobo * percent) / 100);
  const claimed = await OrgPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['initialized'] } },
    {
      $set: {
        status: 'paid',
        platformPercent: percent,
        platformFeeKobo,
        orgShareKobo: Math.max(0, payment.grossKobo - platformFeeKobo - (payment.paystackFeeKobo ?? 0)),
        providerTransactionId: verified.transactionId ?? null,
        paidAt: verified.paidAt ?? new Date(),
        failureReason: null,
      },
    },
    { new: true },
  );
  if (!claimed) {
    const current = await OrgPayment.findById(payment._id);
    return { payment: current, duplicate: current?.status === 'paid', access: current?.status === 'paid' };
  }
  return { payment: claimed, duplicate: false, access: true };
};

/** Start (or resume) the checkout for one paid exam. */
export const initializeExamCheckout = async (org, student, examId, { idempotencyKey = null } = {}) => {
  await requireStudio(org._id);
  // The tenant resolver returns a light organisation (name/slug/status), so the settlement details
  // come from a fresh read rather than the request's copy.
  const payer = await Organization.findById(org._id).select('slug payout').lean();
  requirePayout(payer);

  const exam = await OrgExam.findOne({ _id: examId, organization: org._id, status: 'published' }).lean();
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', 'That exam does not exist.');
  if (!(exam.priceMinor > 0)) throw new AppError(422, 'EXAM_IS_FREE', 'This exam does not need a payment.');

  if (idempotencyKey) {
    const replay = await OrgPayment.findOne({ organization: org._id, idempotencyKey }).lean();
    if (replay) {
      if (String(replay.student) !== String(student._id)) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'That payment reference belongs to someone else.');
      }
      return {
        payment: paymentView(replay),
        authorizationUrl: replay.authorizationUrl,
        reference: replay.reference,
        amountKobo: replay.grossKobo,
        currency: replay.currency,
        alreadyPaid: replay.status === 'paid',
      };
    }
  }

  const paid = await OrgPayment.findOne({
    organization: org._id,
    student: student._id,
    item: 'exam',
    itemRef: exam._id,
    status: 'paid',
  }).lean();
  if (paid) {
    return { payment: paymentView(paid), alreadyPaid: true, access: true, reference: paid.reference };
  }

  const percent = await getPlatformPercent();
  const platformFeeKobo = Math.round((exam.priceMinor * percent) / 100);
  const reference = referenceFor(org._id);
  const payment = await OrgPayment.create({
    organization: org._id,
    student: student._id,
    item: 'exam',
    itemRef: exam._id,
    itemTitle: exam.title,
    reference,
    currency: exam.currency ?? 'NGN',
    grossKobo: exam.priceMinor,
    platformPercent: percent,
    platformFeeKobo,
    orgShareKobo: Math.max(0, exam.priceMinor - platformFeeKobo),
    status: 'initialized',
    // Omit the key entirely when absent: a unique+sparse index still indexes an explicit null.
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  if (!orgPaystackConfigured()) {
    await OrgPayment.deleteOne({ _id: payment._id });
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  }

  const callbackUrl = `${config.CLIENT_URL}/exam/complete?tenant=${encodeURIComponent(payer.slug ?? '')}`;
  let initialized;
  try {
    initialized = await initializeOrgTransaction({
      reference,
      email: student.email,
      amountKobo: payment.grossKobo,
      currency: payment.currency,
      callbackUrl,
      subaccount: payer.payout.subaccountCode,
      metadata: {
        kind: 'org_exam',
        organizationId: String(org._id),
        examId: String(exam._id),
        studentId: String(student._id),
      },
    });
  } catch (error) {
    await OrgPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed', failureReason: 'initialize_failed' } });
    throw error;
  }

  payment.authorizationUrl = initialized.authorizationUrl;
  await payment.save();
  return {
    payment: paymentView(payment),
    authorizationUrl: initialized.authorizationUrl,
    reference,
    amountKobo: payment.grossKobo,
    currency: payment.currency,
  };
};

/** Re-check with the provider. Only a confirmed success marks the payment paid. */
export const verifyExamPayment = async (orgId, studentId, reference) => {
  const payment = await OrgPayment.findOne({ organization: orgId, student: studentId, reference });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'That payment does not exist.');
  if (payment.status === 'paid') return { payment: paymentView(payment), access: true, duplicate: true };
  if (payment.status === 'refunded' || payment.status === 'failed') {
    return { payment: paymentView(payment), access: false, duplicate: false };
  }
  const verified = await verifyOrgTransaction(reference);
  const result = await settle(payment, verified);
  return { payment: paymentView(result.payment), access: result.access, duplicate: result.duplicate };
};

/**
 * Paystack's server-to-server callback. The signature covers the exact bytes, so the route must
 * receive `req.rawBody`. Unknown references are ignored rather than treated as an error: the same
 * endpoint also serves the platform's own dispatchers.
 */
export const handleOrgPaymentWebhook = async (rawBody, signature, body) => {
  if (!verifyOrgWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid payment signature.');
  }
  const event = parseOrgWebhook(body);
  if (!event) return { ignored: true };

  const payment = await OrgPayment.findOne({ reference: event.reference });
  if (!payment) return { ignored: true };

  if (event.type === 'charge.failed') {
    if (payment.status === 'initialized') {
      payment.status = 'failed';
      payment.failureReason = 'provider_failed';
      await payment.save();
    }
    return { handled: true, status: payment.status };
  }

  if (event.type === 'refund.processed' || event.type === 'refund.success') {
    if (payment.status === 'refunded') return { handled: true, duplicate: true, status: 'refunded' };
    payment.status = 'refunded';
    payment.refundedAt = new Date();
    payment.refundReference = event.refundReference ?? event.reference;
    await payment.save();
    return { handled: true, status: 'refunded' };
  }

  if (event.type !== 'charge.success') return { ignored: true };

  const verified = await verifyOrgTransaction(event.reference);
  const result = await settle(payment, verified);
  return { handled: true, duplicate: result.duplicate, status: result.payment.status };
};

/** Support-only refund. The provider call happens first, so a failed refund changes nothing. */
export const refundOrgPayment = async (paymentId, reason = '') => {
  const payment = await OrgPayment.findById(paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'That payment does not exist.');
  if (payment.status !== 'paid') throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a paid payment can be refunded.');
  const refund = await refundOrgTransaction({ reference: payment.reference, amountKobo: payment.grossKobo });
  payment.status = 'refunded';
  payment.refundedAt = new Date();
  payment.refundReference = refund.refundId || null;
  payment.failureReason = reason || null;
  await payment.save();
  return paymentView(payment);
};
