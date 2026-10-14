import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { Campaign } from '../../models/Campaign.js';
import { AdPayment } from '../../models/AdPayment.js';
import { AppError } from '../../utils/AppError.js';
import { validationError, notFound } from '../../utils/ads/errors.js';
import { computePrice } from '../../utils/ads/pricing.js';
import { STATUS } from '../../utils/ads/campaignState.js';
import { logger } from '../../utils/logger.js';
import { recordAction } from '../audit.service.js';
import { getProvider } from './payment/index.js';
import { getSettings } from './settings.service.js';
import { transition, notPurged } from './campaign.service.js';

const newReference = () => `ADS-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`.toUpperCase();

export const quote = async (user, campaignIds) => {
  const settings = await getSettings();
  const campaigns = await Campaign.find({ _id: { $in: campaignIds }, advertiser: user._id, ...notPurged() });
  if (campaigns.length !== new Set(campaignIds.map(String)).size) throw notFound('Campaign');
  const items = campaigns.map((c) => ({ campaign: c._id, name: c.name, ...computePrice(settings, c.durationDays) }));
  return { items, amountKobo: items.reduce((a, i) => a + i.totalKobo, 0), currency: 'NGN' };
};

/** Return claimed campaigns to draft (checkout failed / abandoned). */
const releaseCampaigns = async (payment, reason) => {
  for (const item of payment.items) {
    await transition({
      id: item.campaign, from: STATUS.PENDING_PAYMENT, to: STATUS.DRAFT, action: 'checkout_released', reason,
      set: { paymentStatus: 'unpaid' }, unset: { payment: 1 }, extraFilter: { payment: payment._id },
    });
  }
};

export const createCheckout = async (user, { campaignIds, acceptTerms, termsVersion, idempotencyKey }, req) => {
  const settings = await getSettings();
  if (!acceptTerms) throw validationError({ acceptTerms: 'You must accept the advertising terms, content rules and privacy policy.' });
  if (termsVersion !== settings.termsVersion) {
    throw new AppError(409, 'TERMS_VERSION_MISMATCH', 'The advertising terms were updated. Please review and accept the latest version.');
  }
  const ids = [...new Set(campaignIds.map(String))];
  if (ids.length > settings.maxCampaignsPerCheckout) {
    throw validationError({ campaignIds: `At most ${settings.maxCampaignsPerCheckout} campaigns per checkout.` });
  }

  if (idempotencyKey) {
    const prior = await AdPayment.findOne({ advertiser: user._id, idempotencyKey });
    if (prior) {
      const same = prior.items.map((i) => String(i.campaign)).sort().join() === [...ids].sort().join();
      if (!same) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request.');
      return checkoutView(prior);
    }
  }

  const provider = getProvider();
  if (!provider) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is not available yet.');

  const campaigns = await Campaign.find({ _id: { $in: ids }, advertiser: user._id, ...notPurged() });
  if (campaigns.length !== ids.length) throw notFound('Campaign');
  const notDraft = campaigns.find((c) => c.status !== STATUS.DRAFT);
  if (notDraft) {
    throw new AppError(409, 'NOT_PAYABLE', `Campaign "${notDraft.name}" is "${notDraft.status}" and cannot be checked out.`);
  }

  // Server-side pricing; the client never supplies amounts.
  const items = campaigns.map((c) => {
    const p = computePrice(settings, c.durationDays);
    return { campaign: c._id, campaignName: c.name, days: p.days, dailyFeeKobo: p.dailyFeeKobo, amountKobo: p.totalKobo };
  });
  const amountKobo = items.reduce((a, i) => a + i.amountKobo, 0);

  let payment;
  try {
    payment = await AdPayment.create({
      reference: newReference(), advertiser: user._id, idempotencyKey, items, amountKobo, currency: 'NGN', provider: provider.name,
    });
  } catch (e) {
    if (e?.code === 11000 && idempotencyKey) return checkoutView(await AdPayment.findOne({ advertiser: user._id, idempotencyKey }));
    throw e;
  }

  // Claim each campaign atomically (draft → pending_payment). Two concurrent
  // checkouts of the same campaign: exactly one claim succeeds.
  const claimed = [];
  const terms = { version: settings.termsVersion, acceptedAt: new Date(), ip: req?.ip };
  for (const item of items) {
    const doc = await transition({
      id: item.campaign, from: STATUS.DRAFT, to: STATUS.PENDING_PAYMENT, actor: user._id, actorRole: 'advertiser', action: 'checkout_started',
      set: { paymentStatus: 'pending', payment: payment._id, priceKobo: item.amountKobo, dailyFeeKobo: item.dailyFeeKobo, terms },
      extraFilter: { advertiser: user._id },
    });
    if (!doc) break;
    claimed.push(item);
  }
  if (claimed.length !== items.length) {
    await releaseCampaigns({ _id: payment._id, items: claimed }, 'checkout conflict');
    await AdPayment.deleteOne({ _id: payment._id });
    throw new AppError(409, 'CHECKOUT_CONFLICT', 'One of the campaigns is already being checked out. Reload and try again.');
  }

  try {
    const init = await provider.initialize({
      reference: payment.reference, email: user.email, amountKobo, currency: 'NGN',
      callbackUrl: config.ADS_PAYMENT_CALLBACK_URL, metadata: { paymentId: String(payment._id) },
    });
    payment.authorizationUrl = init.authorizationUrl;
    await payment.save();
  } catch (e) {
    logger.error('Payment initialize failed', e.message);
    payment.status = 'failed';
    payment.failureReason = 'PROVIDER_INITIALIZE_FAILED';
    await payment.save();
    await releaseCampaigns(payment, 'provider initialize failed');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not start the payment. Please try again.');
  }
  return checkoutView(payment);
};

export const checkoutView = (p) => ({
  paymentId: String(p._id), reference: p.reference, amountKobo: p.amountKobo, currency: p.currency, status: p.status,
  authorizationUrl: p.status === 'initialized' ? p.authorizationUrl : undefined,
  items: p.items.map((i) => ({ campaignId: String(i.campaign), name: i.campaignName, days: i.days, amountKobo: i.amountKobo })),
});

/**
 * Apply a provider-verified result. Idempotent and race-safe: the
 * `status != paid` claim has exactly one winner; later callers (webhook retry,
 * manual verify, reconciler) are no-ops.
 */
export const applyProviderResult = async (payment, result, { source }) => {
  if (['paid', 'refunding', 'refunded'].includes(payment.status)) return { payment, applied: false };
  if (result.status === 'pending') return { payment, applied: false };
  if (result.status !== 'success') {
    if (result.status === 'failed') {
      const claimed = await AdPayment.findOneAndUpdate(
        { _id: payment._id, status: 'initialized' }, { $set: { status: 'failed', failureReason: 'PROVIDER_REPORTED_FAILED' } }, { new: true },
      );
      if (claimed) await releaseCampaigns(claimed, 'payment failed');
    }
    return { payment, applied: false };
  }
  if (result.amountKobo !== payment.amountKobo || result.currency !== payment.currency) {
    logger.error('Payment amount/currency mismatch', payment.reference, result.amountKobo, result.currency);
    const claimed = await AdPayment.findOneAndUpdate(
      { _id: payment._id, status: 'initialized' }, { $set: { status: 'failed', failureReason: 'AMOUNT_MISMATCH' } }, { new: true },
    );
    if (claimed) await releaseCampaigns(claimed, 'amount mismatch');
    return { payment, applied: false };
  }

  const now = new Date();
  const claimed = await AdPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['initialized', 'failed', 'abandoned'] } },
    { $set: { status: 'paid', paidAt: result.paidAt ?? now, verifiedAt: now, providerTransactionId: result.transactionId } },
    { new: true },
  );
  if (!claimed) return { payment, applied: false };

  await activatePaidItems(claimed);
  await recordAction({
    actorId: claimed.advertiser, action: 'AD_PAYMENT_VERIFIED', targetId: claimed._id, targetType: 'AdPayment',
    metadata: { reference: claimed.reference, amountKobo: claimed.amountKobo, source },
  });
  return { payment: claimed, applied: true };
};

/** pending_payment → pending_review for every item (also used by the repair job). */
export const activatePaidItems = async (payment) => {
  let skipped = 0;
  for (const item of payment.items) {
    const doc = await transition({
      id: item.campaign, from: STATUS.PENDING_PAYMENT, to: STATUS.PENDING_REVIEW, action: 'payment_verified',
      set: { paymentStatus: 'paid', payment: payment._id, submittedAt: new Date() },
    });
    if (!doc) {
      const c = await Campaign.findById(item.campaign).select('status payment');
      if (c && !(c.status !== STATUS.PENDING_PAYMENT && String(c.payment) === String(payment._id))) skipped += 1;
    }
  }
  if (skipped) {
    await AdPayment.updateOne({ _id: payment._id }, { $set: { failureReason: 'LATE_PAYMENT_CAMPAIGNS_NOT_ACTIVATED' } });
  }
};

export const verifyByReference = async (reference, { source, advertiserId } = {}) => {
  const filter = { reference };
  if (advertiserId) filter.advertiser = advertiserId;
  const payment = await AdPayment.findOne(filter);
  if (!payment) throw notFound('Payment');
  if (['paid', 'refunding', 'refunded'].includes(payment.status)) return { payment, applied: false };
  const provider = getProvider();
  if (!provider) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is not available yet.');
  let result;
  try {
    result = await provider.verify(payment.reference);
  } catch (e) {
    logger.error('Payment verify failed', e.message);
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not verify the payment right now. Please try again shortly.');
  }
  return applyProviderResult(payment, result, { source });
};

/**
 * Signed webhook. Authenticity: HMAC over the raw body. Truth: we never trust
 * the webhook payload's amount/status — we re-verify with the provider API.
 */
export const handleWebhook = async (rawBody, signature, body) => {
  const provider = getProvider();
  if (!provider || !provider.verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
  }
  const evt = provider.parseWebhook(body);
  if (!evt || evt.type !== 'charge.success') return { ignored: true };
  const payment = await AdPayment.findOne({ reference: evt.reference });
  if (!payment) return { ignored: true };
  const result = await verifyByReference(evt.reference, { source: 'webhook' });
  return { applied: result.applied };
};

/** Advertiser abandons an unpaid checkout; guarded so a paid one can't be cancelled. */
export const cancelCheckout = async (user, paymentId) => {
  const payment = await AdPayment.findOne({ _id: paymentId, advertiser: user._id });
  if (!payment) throw notFound('Payment');
  if (payment.status === 'paid') throw new AppError(409, 'ALREADY_PAID', 'This checkout has already been paid.');
  const provider = getProvider();
  if (provider && payment.status === 'initialized') {
    const r = await provider.verify(payment.reference).catch(() => ({ status: 'pending' }));
    if (r.status === 'success') {
      await applyProviderResult(payment, r, { source: 'cancel-check' });
      throw new AppError(409, 'ALREADY_PAID', 'This checkout has already been paid.');
    }
  }
  const claimed = await AdPayment.findOneAndUpdate(
    { _id: payment._id, status: 'initialized' }, { $set: { status: 'abandoned' } }, { new: true },
  );
  if (claimed) await releaseCampaigns(claimed, 'checkout cancelled');
  return checkoutView(claimed ?? payment);
};

export const listPayments = async (filter, { page, limit }) => {
  const [items, total] = await Promise.all([
    AdPayment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AdPayment.countDocuments(filter),
  ]);
  return { items, page, limit, total };
};

/**
 * Admin refund of a whole payment. Allowed only when every campaign in it is
 * flagged `refund_due` (rejected with refund). Race-safe: only one caller can
 * move paid -> refunding; a provider failure puts it back to paid.
 */
export const refundPayment = async (paymentId, { reason }, req) => {
  const provider = getProvider();
  if (!provider?.refund) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Refunds are not available for the configured provider.');
  const payment = await AdPayment.findById(paymentId);
  if (!payment) throw notFound('Payment');
  if (payment.status !== 'paid') throw new AppError(409, 'NOT_REFUNDABLE', `A payment that is "${payment.status}" cannot be refunded.`);

  const ids = payment.items.map((i) => i.campaign);
  const existing = await Campaign.find({ _id: { $in: ids } }).select('paymentStatus').lean();
  if (existing.some((c) => c.paymentStatus !== 'refund_due')) {
    throw new AppError(409, 'CAMPAIGN_NOT_REFUNDABLE', 'Reject the campaign with "refund" before refunding its payment.');
  }

  const claimed = await AdPayment.findOneAndUpdate({ _id: payment._id, status: 'paid' }, { $set: { status: 'refunding' } }, { new: true });
  if (!claimed) throw new AppError(409, 'NOT_REFUNDABLE', 'This payment is already being refunded.');
  try {
    await provider.refund({ reference: claimed.reference, amountKobo: claimed.amountKobo });
  } catch (e) {
    logger.error('Refund failed', claimed.reference, e.message);
    await AdPayment.updateOne({ _id: claimed._id, status: 'refunding' }, { $set: { status: 'paid' } });
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The provider could not process the refund. Please try again.');
  }
  const done = await AdPayment.findOneAndUpdate(
    { _id: claimed._id }, { $set: { status: 'refunded', refundedAt: new Date(), refundedBy: req.user._id, refundReason: reason } }, { new: true },
  );
  await Campaign.updateMany({ _id: { $in: ids }, paymentStatus: 'refund_due' }, { $set: { paymentStatus: 'refunded' } });
  await recordAction({
    actorId: req.user._id, action: 'AD_PAYMENT_REFUND', targetId: done._id, targetType: 'AdPayment',
    metadata: { reference: done.reference, amountKobo: done.amountKobo, reason }, req,
  });
  return done;
};
