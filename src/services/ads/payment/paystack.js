import crypto from 'node:crypto';
import { config } from '../../../config/env.js';
import { normalizePaystackTransferInstructions } from '../../orgPaystack.service.js';

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

  async initialize({ reference, email, amountKobo, currency = 'NGN', callbackUrl, metadata, channels, bankTransferExpiresAt }) {
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
        metadata,
      };

      const { status, json } = await call('/charge', {
        method: 'POST',
        body: JSON.stringify(body),
      });

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
      throw new Error(`Paystack bank transfer initialization failed (${status}): ${json?.message || 'Unknown error'}`);
    }

    const body = {
      reference,
      email,
      amount: amountKobo,
      currency,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      ...(Array.isArray(channels) && channels.length ? { channels } : {}),
      metadata,
    };
    const { status, json } = await call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (status !== 200 || !json.status) throw new Error(`Paystack initialize failed (${status})`);
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
    if (status !== 200 || !json.status) throw new Error(`Paystack verify failed (${status})`);
    const d = json.data;
    const createdAt = d.created_at ? new Date(d.created_at) : null;
    const isRecent = createdAt && (Date.now() - createdAt.getTime() < 30 * 60 * 1000);
    let mappedStatus = 'pending';
    if (d.status === 'success') {
      mappedStatus = 'success';
    } else if (['failed', 'reversed', 'cancelled'].includes(d.status)) {
      mappedStatus = 'failed';
    } else if (d.status === 'abandoned' || d.status === 'expired') {
      mappedStatus = isRecent ? 'pending' : 'failed';
    } else {
      mappedStatus = 'pending';
    }

    return {
      status: mappedStatus,
      amountKobo: d.amount,
      currency: d.currency,
      transactionId: String(d.id),
      paidAt: d.paid_at ? new Date(d.paid_at) : undefined,
      channel: d.channel,
      transferInstructions: normalizePaystackTransferInstructions(d),
      rawStatus: d.status,
      raw: d,
    };
  },

  async fetch(reference) { return this.verify(reference); },

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
