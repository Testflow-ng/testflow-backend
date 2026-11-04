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

const realProvider = {
  async initialize({ reference, email, amountKobo, currency, callbackUrl, subaccount, metadata }) {
    const { status, json } = await call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        reference,
        email,
        amount: amountKobo,
        currency,
        callback_url: callbackUrl,
        ...(subaccount ? { subaccount } : {}),
        metadata,
      }),
    });
    if (status !== 200 || !json.status) throw new AppError(502, 'PAYMENT_INIT_FAILED', 'Could not start the payment. Please try again.');
    return { authorizationUrl: json.data.authorization_url };
  },

  async verify(reference) {
    const { status, json } = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (status === 404) return { status: 'not_found' };
    if (status !== 200 || !json.status) throw new AppError(502, 'PAYMENT_VERIFY_FAILED', 'Could not verify the payment. Please try again.');
    const data = json.data;
    const map = { success: 'success', failed: 'failed', abandoned: 'failed', reversed: 'failed' };
    return {
      status: map[data.status] ?? 'pending',
      amountKobo: data.amount,
      currency: data.currency,
      transactionId: String(data.id),
      paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
    };
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
export const refundOrgTransaction = (input) => requireProvider().refund(input);
export const verifyOrgWebhookSignature = (rawBody, signature) => requireProvider().verifyWebhookSignature(rawBody, signature);
export const parseOrgWebhook = (body) => requireProvider().parseWebhook(body);
