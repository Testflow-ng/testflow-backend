import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * The Paystack calls the organisation console needs that the shared payment adapter does not
 * expose: the bank list, an account-name resolve, and a subaccount create/update.
 *
 * The adapter in `services/ads/payment` stays the project's one *checkout* integration and is not
 * touched; this file only adds the settlement side. Every function refuses with
 * `PAYMENT_NOT_CONFIGURED` when there is no key, so a local server without Paystack behaves like a
 * clearly-off feature rather than a silent failure.
 */

const BASE = 'https://api.paystack.co';

export const paystackConfigured = () =>
  config.PAYMENT_PROVIDER === 'paystack' && Boolean(config.PAYSTACK_SECRET_KEY);

const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

const requireConfigured = () => {
  if (!paystackConfigured()) {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  }
};

/** The Nigerian bank list, newest Paystack response or the static fallback. */
export const listPaystackBanks = async () => {
  requireConfigured();
  const { status, json } = await call('/bank?country=nigeria&perPage=200');
  if (status !== 200 || !json.status) throw new AppError(502, 'BANK_LIST_FAILED', 'Could not load the bank list. Please try again.');
  return (json.data ?? []).map((b) => ({ code: String(b.code), name: b.name }));
};

/** Resolve an account number to its account name, so an owner can confirm before saving. */
export const resolvePaystackAccount = async ({ bankCode, accountNumber }) => {
  requireConfigured();
  const { status, json } = await call(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  if (status !== 200 || !json.status || !json.data?.account_name) {
    throw new AppError(422, 'ACCOUNT_RESOLVE_FAILED', 'We could not resolve that account. Check the bank and number.');
  }
  return { accountName: json.data.account_name };
};

/**
 * Create the subaccount the first time, update it afterwards. `percentage_charge` is Testflow's
 * share and is set here from the server-side number, never from the client.
 */
export const upsertPaystackSubaccount = async ({ businessName, bankCode, accountNumber, percentageCharge, existingCode }) => {
  requireConfigured();
  const body = JSON.stringify({
    business_name: businessName,
    settlement_bank: bankCode,
    account_number: accountNumber,
    percentage_charge: percentageCharge,
  });

  const { status, json } = existingCode
    ? await call(`/subaccount/${encodeURIComponent(existingCode)}`, { method: 'PUT', body })
    : await call('/subaccount', { method: 'POST', body });

  if ((status !== 200 && status !== 201) || !json.status || !json.data?.subaccount_code) {
    throw new AppError(502, 'SUBACCOUNT_FAILED', 'Could not set up the payout account. Please try again.');
  }
  return { subaccountCode: json.data.subaccount_code, accountName: json.data.account_name ?? null };
};

/**
 * Transaction calls for student payments and plan checkout. The shared Ads adapter stays the
 * project's one *advertising* checkout integration; these calls exist because an organisation
 * payment must carry the organiser's `subaccount`, which that adapter does not expose.
 *
 * `setOrgPaystackForTests` mirrors the Ads test hook so the suite never touches the network.
 */
let override = null;
export const setOrgPaystackForTests = (provider) => {
  override = provider;
};

const toKoboNumber = (value) => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const pickString = (...values) => {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
};

const pickDate = (...values) => {
  for (const v of values) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
};

/**
 * Normalize provider "Pay with Transfer"/bank-transfer instruction fields defensively.
 * Paystack responses can vary by integration/channel and account configuration; we only map
 * fields the provider actually returns and never fabricate account details.
 */
export const normalizePaystackTransferInstructions = (data, fallback = {}) => {
  if (!data || typeof data !== 'object') return null;
  const auth = data.authorization && typeof data.authorization === 'object' ? data.authorization : {};
  const candidates = [data, auth, data.bank_transfer, data.transfer, auth.transfer].filter((v) => v && typeof v === 'object');
  const merged = Object.assign({}, ...candidates);
  const bankObj = (merged.bank && typeof merged.bank === 'object') ? merged.bank : {};
  const bankName = pickString(merged.bank_name, merged.receiver_bank, bankObj.name, typeof merged.bank === 'string' ? merged.bank : undefined, merged.bankName);
  const accountName = pickString(merged.account_name, merged.receiver_name, merged.accountName, merged.receiver);
  const accountNumber = pickString(merged.account_number, merged.transfer_account, merged.accountNumber, merged.receiver_account_number);
  const amountKobo = toKoboNumber(merged.amount ?? merged.transfer_amount ?? merged.requested_amount ?? data.amount ?? fallback.amountKobo);
  const currency = pickString(merged.currency, data.currency, fallback.currency, 'NGN')?.toUpperCase();
  const expiresAt = pickDate(
    merged.account_expires_at,
    merged.expires_at,
    merged.expiry,
    merged.expiry_date,
    merged.transfer_account_expires_at,
    fallback.expiresAt,
  );
  const transferReference = pickString(merged.transfer_reference, merged.reference, merged.transaction_reference, fallback.reference);
  const displayText = pickString(merged.display_text, merged.message, merged.note, merged.description);
  const channel = pickString(merged.channel, data.channel, auth.channel, 'bank_transfer');

  const hasUsefulField = Boolean(bankName || accountName || accountNumber || transferReference || displayText || expiresAt);
  if (!hasUsefulField) return null;
  return {
    ...(bankName ? { bankName } : {}),
    ...(accountName ? { accountName } : {}),
    ...(accountNumber ? { accountNumber } : {}),
    ...(amountKobo != null ? { amountKobo } : {}),
    ...(currency ? { currency } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(transferReference ? { transferReference } : {}),
    ...(displayText ? { displayText } : {}),
    ...(channel ? { channel } : {}),
  };
};

const mapProviderStatus = (status, createdAt) => {
  if (status === 'success') return 'success';
  if (status === 'failed' || status === 'reversed' || status === 'cancelled') return 'failed';
  if (status === 'abandoned' || status === 'expired') {
    const isRecent = createdAt && (Date.now() - new Date(createdAt).getTime() < 30 * 60 * 1000);
    return isRecent ? 'pending' : 'failed';
  }
  return 'pending';
};

const normalizeTransaction = (data) => ({
  status: mapProviderStatus(data?.status, data?.created_at),
  amountKobo: data?.amount,
  currency: data?.currency,
  transactionId: data?.id != null ? String(data.id) : undefined,
  paidAt: data?.paid_at ? new Date(data.paid_at) : undefined,
  channel: pickString(data?.channel, data?.authorization?.channel),
  gatewayResponse: pickString(data?.gateway_response, data?.message),
  transferInstructions: normalizePaystackTransferInstructions(data),
  rawStatus: pickString(data?.status),
});

const realProvider = {
  async initialize({ reference, email, amountKobo, currency = 'NGN', callbackUrl, subaccount, metadata, channels, bankTransferExpiresAt }) {
    const useBankTransfer = (Array.isArray(channels) && channels.includes('bank_transfer')) || metadata?.paymentMethod === 'paystack_bank_transfer';

    if (useBankTransfer) {
      const expiresAt = bankTransferExpiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const body = {
        reference,
        email,
        amount: amountKobo,
        currency: currency || 'NGN',
        bank_transfer: {
          account_expires_at: expiresAt,
        },
        ...(subaccount ? { subaccount } : {}),
        metadata,
      };
      const { status, json } = await call('/charge', { method: 'POST', body: JSON.stringify(body) });
      if (status === 200 && json.status && json.data) {
        const data = json.data;
        return {
          authorizationUrl: null,
          accessCode: null,
          reference: data.reference ?? reference,
          transferInstructions: normalizePaystackTransferInstructions(data, { amountKobo, currency, reference, expiresAt }),
          channel: 'bank_transfer',
          raw: data,
        };
      }
      throw new AppError(502, 'PAYMENT_INIT_FAILED', json?.message || 'Could not start the bank transfer payment.');
    }

    const body = {
      reference,
      email,
      amount: amountKobo,
      currency,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      ...(subaccount ? { subaccount } : {}),
      ...(Array.isArray(channels) && channels.length ? { channels } : {}),
      metadata,
    };
    const { status, json } = await call('/transaction/initialize', { method: 'POST', body: JSON.stringify(body) });
    if (status !== 200 || !json.status) {
      throw new AppError(502, 'PAYMENT_INIT_FAILED', json?.message || 'Could not start the payment. Please try again.');
    }
    const data = json.data && typeof json.data === 'object' ? json.data : {};
    return {
      authorizationUrl: data.authorization_url ?? null,
      accessCode: data.access_code ?? null,
      reference: data.reference ?? reference,
      transferInstructions: normalizePaystackTransferInstructions(data, { amountKobo, currency, reference }),
      raw: data,
    };
  },

  async verify(reference) {
    const { status, json } = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (status === 404) return { status: 'not_found' };
    if (status !== 200 || !json.status) throw new AppError(502, 'PAYMENT_VERIFY_FAILED', 'Could not verify the payment. Please try again.');
    return normalizeTransaction(json.data);
  },

  async fetch(reference) {
    // Verify is the authoritative reference lookup for a transaction reference.
    return this.verify(reference);
  },

  async refund({ reference, amountKobo }) {
    const { status, json } = await call('/refund', {
      method: 'POST',
      body: JSON.stringify({ transaction: reference, amount: amountKobo }),
    });
    if (status !== 200 || !json.status) throw new AppError(502, 'REFUND_FAILED', 'The refund could not be processed.');
    return { refundId: String(json.data?.id ?? ''), status: json.data?.status };
  },

  verifyWebhookSignature(rawBody, signature) {
    if (!rawBody || !signature || !config.PAYSTACK_SECRET_KEY) return false;
    const expected = crypto.createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  parseWebhook(body) {
    if (!body?.event || !body?.data?.reference) return null;
    return {
      type: body.event,
      reference: body.data.reference,
      eventId: body.data.id ? String(body.data.id) : null,
      refundReference: body.data.transaction_reference ?? null,
      transferInstructions: normalizePaystackTransferInstructions(body.data),
      channel: pickString(body?.data?.channel, body?.data?.authorization?.channel),
      amountKobo: body?.data?.amount,
      currency: body?.data?.currency,
    };
  },
};

const provider = () => override ?? (paystackConfigured() ? realProvider : null);

export const orgPaystackConfigured = () => Boolean(provider());

const requireProvider = () => {
  const p = provider();
  if (!p) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  return p;
};

export const initializeOrgTransaction = (input) => requireProvider().initialize(input);
export const verifyOrgTransaction = (reference) => requireProvider().verify(reference);
export const fetchOrgTransaction = (reference) => {
  const p = requireProvider();
  return typeof p.fetch === 'function' ? p.fetch(reference) : p.verify(reference);
};
export const refundOrgTransaction = (input) => requireProvider().refund(input);
export const verifyOrgWebhookSignature = (rawBody, signature) => requireProvider().verifyWebhookSignature(rawBody, signature);
export const parseOrgWebhook = (body) => requireProvider().parseWebhook(body);
