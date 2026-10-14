import { Campaign } from '../models/Campaign.js';
import { AdPayment } from '../models/AdPayment.js';
import { STATUS } from '../utils/ads/campaignState.js';
import { getSettings } from '../services/ads/settings.service.js';
import { transition } from '../services/ads/campaign.service.js';
import { activatePaidItems, verifyByReference, cancelCheckout } from '../services/ads/payment.service.js';
import { getProvider } from '../services/ads/payment/index.js';
import { runJob, withRetry } from './runner.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/** scheduled → active once startsAt has passed. */
export const activateDue = async (ctx, now = new Date()) => {
  const due = await Campaign.find({ status: STATUS.SCHEDULED, startsAt: { $lte: now }, endsAt: { $gt: now } }).select('_id').limit(BATCH).lean();
  for (const { _id } of due) {
    const doc = await transition({ id: _id, from: STATUS.SCHEDULED, to: STATUS.ACTIVE, action: 'activated', extraFilter: { startsAt: { $lte: now } } });
    if (doc) ctx.count('activated');
  }
};

/** active|scheduled|suspended → expired when the paid period is over. Sets the purge deadline. */
export const expireDue = async (ctx, now = new Date()) => {
  const { retentionDays } = await getSettings();
  const due = await Campaign.find({ status: { $in: [STATUS.ACTIVE, STATUS.SCHEDULED, STATUS.SUSPENDED] }, endsAt: { $lte: now } })
    .select('_id endsAt').limit(BATCH).lean();
  for (const c of due) {
    const doc = await transition({
      id: c._id, from: [STATUS.ACTIVE, STATUS.SCHEDULED, STATUS.SUSPENDED], to: STATUS.EXPIRED, action: 'expired',
      set: { expiredAt: c.endsAt, purgeAt: new Date(c.endsAt.getTime() + retentionDays * DAY_MS) },
      extraFilter: { endsAt: { $lte: now } },
    });
    if (doc) ctx.count('expired');
  }
};

/** Crash-recovery: payments marked paid whose campaigns never left pending_payment. */
export const repairPaid = async (ctx) => {
  const stuck = await Campaign.find({ status: STATUS.PENDING_PAYMENT, payment: { $exists: true } }).select('payment').limit(BATCH).lean();
  const ids = [...new Set(stuck.map((c) => String(c.payment)))];
  for (const id of ids) {
    const p = await AdPayment.findOne({ _id: id, status: 'paid' });
    if (p) { await activatePaidItems(p); ctx.count('repaired'); }
  }
};

/** Reconcile checkouts whose webhook never arrived; abandon those unpaid after 2h. */
export const reconcilePending = async (ctx, now = new Date()) => {
  if (!getProvider()) return;
  const stale = await AdPayment.find({ status: 'initialized', createdAt: { $lte: new Date(now - 15 * 60 * 1000) } }).limit(100);
  for (const p of stale) {
    try {
      const r = await verifyByReference(p.reference, { source: 'reconciler' });
      if (r.applied) { ctx.count('reconciledPaid'); continue; }
      if (now - p.createdAt > 2 * 60 * 60 * 1000) {
        await cancelCheckout({ _id: p.advertiser }, p._id);
        ctx.count('abandoned');
      }
    } catch (e) {
      ctx.fail(`${p.reference}: ${e.code ?? e.message}`);
    }
  }
};

export const runLifecycle = () =>
  runJob('ads-lifecycle', async (ctx) => {
    for (const step of [repairPaid, activateDue, expireDue, reconcilePending]) {
      try { await withRetry(() => step(ctx)); } catch (e) { ctx.fail(`${step.name}: ${e.message}`); }
    }
  }, { lockTtlMs: 4 * 60 * 1000 });
