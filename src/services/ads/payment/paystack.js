import crypto from 'node:crypto';
import { config } from '../../../config/env.js';

/**
 * Paystack adapter implementing the PaymentProvider contract:
 *   initialize({reference,email,amountKobo,currency,callbackUrl,metadata}) -> {authorizationUrl}
 *   verify(reference) -> {status:'success'|'failed'|'pending'|'not_found', amountKobo, currency, transactionId, paidAt}
 *   refund({reference,amountKobo}) -> {refundId,status}
 *   verifyWebhookSignature(rawBody:Buffer, signature) -> boolean
 *   parseWebhook(body) -> {type, reference} | null
 * NOTE: written against Paystack's public API docs; NOT yet exercised against
 * the live/test API (needs PAYSTACK_SECRET_KEY).
 */
const BASE = 'https://api.paystack.co';

const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

export const paystackProvider = {
  name: 'paystack',

  async initialize({ reference, email, amountKobo, currency, callbackUrl, metadata }) {
    const { status, json } = await call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ reference, email, amount: amountKobo, currency, callback_url: callbackUrl, metadata }),
    });
    if (status !== 200 || !json.status) throw new Error(`Paystack initialize failed (${status})`);
    return { authorizationUrl: json.data.authorization_url };
  },

  async verify(reference) {
    const { status, json } = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (status === 404) return { status: 'not_found' };
    if (status !== 200 || !json.status) throw new Error(`Paystack verify failed (${status})`);
    const d = json.data;
    const map = { success: 'success', failed: 'failed', abandoned: 'failed', reversed: 'failed' };
    return {
      status: map[d.status] ?? 'pending',
      amountKobo: d.amount,
      currency: d.currency,
      transactionId: String(d.id),
      paidAt: d.paid_at ? new Date(d.paid_at) : undefined,
    };
  },

  /** Full refund of a verified transaction. Throws on provider failure. */
  async refund({ reference, amountKobo }) {
    const { status, json } = await call('/refund', { method: 'POST', body: JSON.stringify({ transaction: reference, amount: amountKobo }) });
    if (status !== 200 || !json.status) throw new Error(`Paystack refund failed (${status}): ${json.message ?? ''}`);
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
    return { type: body.event, reference: body.data.reference };
  },
};
