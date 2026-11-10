import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { payoutMode, walletMode } from '../config/payoutMode.js';
import { AppError } from '../utils/AppError.js';
import { Organization } from '../models/Organization.js';
import { OrgPayment } from '../models/OrgPayment.js';
import { OrgWithdrawal } from '../models/OrgWithdrawal.js';
import { User } from '../models/User.js';
import { createTransferRecipient, initiateTransfer, transfersAvailable, verifyPaystackSignature } from './orgPaystack.service.js';
import { sendWithdrawalEmail } from './email.service.js';
import { logger } from '../utils/logger.js';

/**
 * The organisation wallet and withdrawals.
 *
 * Payments for an organisation's exams land in Testflow's own Paystack balance (`settledTo: 'wallet'`).
 * The organisation's share is credited to its wallet, and the owner moves it to the saved bank account
 * with a withdrawal, which is a Paystack transfer from that balance.
 *
 * The balance is never stored; it is computed: shares earned, minus withdrawals that are pending,
 * processing or successful. A failed withdrawal therefore gives the money back by itself. Older
 * payments that Paystack already settled straight to the bank (`settledTo: 'subaccount'`) are not counted.
 */

export const MIN_WITHDRAWAL_KOBO = 100_000; // N1,000
export const WITHDRAWAL_PREFIX = 'WD-';
const LOCK_MS = 30_000;
const IN_FLIGHT = ['pending', 'processing'];

/** Paystack's NGN transfer fee, taken out of the withdrawal: N10 up to N5,000, N25 up to N50,000, else N50. */
export const transferFeeKobo = (amountKobo) => (amountKobo <= 500_000 ? 1000 : amountKobo <= 5_000_000 ? 2500 : 5000);

const view = (w) => ({
  id: String(w._id),
  reference: w.reference,
  status: w.status,
  currency: w.currency,
  amountKobo: w.amountKobo,
  feeKobo: w.feeKobo,
  netKobo: w.netKobo,
  accountName: w.accountName ?? null,
  accountLast4: w.accountNumber ? String(w.accountNumber).slice(-4) : null,
  failureReason: w.status === 'failed' ? (w.failureReason ?? null) : null,
  requestedAt: w.createdAt,
  completedAt: w.completedAt ?? null,
});

const balances = async (orgId) => {
  const oid = new mongoose.Types.ObjectId(String(orgId));
  const [earned, spent] = await Promise.all([
    OrgPayment.aggregate([
      { $match: { organization: oid, status: 'paid', settledTo: 'wallet' } },
      { $group: { _id: null, total: { $sum: '$orgShareKobo' } } },
    ]),
    OrgWithdrawal.aggregate([
      { $match: { organization: oid, status: { $in: ['pending', 'processing', 'success'] } } },
      { $group: { _id: '$status', total: { $sum: '$amountKobo' } } },
    ]),
  ]);
  const earnedKobo = earned[0]?.total ?? 0;
  const byStatus = Object.fromEntries(spent.map((row) => [row._id, row.total]));
  const withdrawnKobo = byStatus.success ?? 0;
  const pendingKobo = (byStatus.pending ?? 0) + (byStatus.processing ?? 0);
  return { earnedKobo, withdrawnKobo, pendingKobo, availableKobo: Math.max(0, earnedKobo - withdrawnKobo - pendingKobo) };
};

export const getWallet = async (orgId) => {
  const org = await Organization.findById(orgId).select('payout').lean();
  const payout = org?.payout ?? {};
  const b = await balances(orgId);
  return {
    mode: payoutMode(),
    currency: 'NGN',
    ...b,
    minimumKobo: MIN_WITHDRAWAL_KOBO,
    payoutReady: payout.status === 'active',
    account: payout.status === 'active'
      ? { accountName: payout.accountName ?? null, last4: payout.accountNumber ? String(payout.accountNumber).slice(-4) : null, bankCode: payout.bankCode ?? null }
      : null,
  };
};

export const listWithdrawals = async (orgId, { page = 1, limit = 20 } = {}) => {
  const [rows, total] = await Promise.all([
    OrgWithdrawal.find({ organization: orgId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OrgWithdrawal.countDocuments({ organization: orgId }),
  ]);
  return { items: rows.map(view), page, limit, total };
};

const notify = async (orgId, kind, withdrawal) => {
  try {
    const org = await Organization.findById(orgId).select('name ownerUser').lean();
    const owner = org?.ownerUser ? await User.findById(org.ownerUser).select('email fullName').lean() : null;
    await sendWithdrawalEmail({ to: owner?.email, name: owner?.fullName, orgName: org?.name, kind, withdrawal });
  } catch (error) {
    logger.warn?.({ err: error }, 'withdrawal email failed');
  }
};

const settleAs = async (reference, from, set) =>
  OrgWithdrawal.findOneAndUpdate({ reference, status: { $in: from } }, { $set: set }, { new: true });

/** Take the money out of the wallet and start the bank transfer. Owner only (enforced by the route). */
export const requestWithdrawal = async (orgId, userId, { amountKobo }) => {
  if (!walletMode()) throw new AppError(409, 'WITHDRAWALS_OFF', 'Your earnings are paid straight to your bank account, so there is nothing to withdraw.');
  if (!Number.isInteger(amountKobo) || amountKobo < MIN_WITHDRAWAL_KOBO) {
    throw new AppError(422, 'AMOUNT_TOO_SMALL', `The smallest withdrawal is ₦${MIN_WITHDRAWAL_KOBO / 100}.`);
  }
  if (!transfersAvailable()) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Withdrawals are not available yet.');

  const now = new Date();
  const locked = await Organization.findOneAndUpdate(
    { _id: orgId, $or: [{ withdrawLockUntil: null }, { withdrawLockUntil: { $lt: now } }] },
    { $set: { withdrawLockUntil: new Date(now.getTime() + LOCK_MS) } },
    { new: true },
  );
  if (!locked) throw new AppError(409, 'WITHDRAWAL_BUSY', 'Another withdrawal is being processed. Try again in a moment.');

  let row;
  try {
    const payout = locked.payout ?? {};
    if (payout.status !== 'active' || !payout.accountNumber || !payout.bankCode) {
      throw new AppError(422, 'PAYOUT_REQUIRED', 'Add your bank account before you withdraw.');
    }
    const { availableKobo } = await balances(orgId);
    if (amountKobo > availableKobo) {
      throw new AppError(422, 'INSUFFICIENT_BALANCE', 'That is more than your available balance.');
    }
    const feeKobo = transferFeeKobo(amountKobo);
    row = await OrgWithdrawal.create({
      organization: orgId,
      requestedBy: userId,
      reference: `${WITHDRAWAL_PREFIX}${crypto.randomBytes(10).toString('hex')}`,
      amountKobo,
      feeKobo,
      netKobo: amountKobo - feeKobo,
      status: 'pending',
      bankCode: payout.bankCode,
      accountNumber: payout.accountNumber,
      accountName: payout.accountName,
    });
  } finally {
    await Organization.updateOne({ _id: orgId }, { $set: { withdrawLockUntil: null } });
  }

  try {
    let recipientCode = locked.payout.transferRecipientCode;
    if (!recipientCode) {
      ({ recipientCode } = await createTransferRecipient({ name: row.accountName || locked.name, bankCode: row.bankCode, accountNumber: row.accountNumber }));
      await Organization.updateOne({ _id: orgId }, { $set: { 'payout.transferRecipientCode': recipientCode } });
    }
    const sent = await initiateTransfer({ reference: row.reference, amountKobo: row.netKobo, recipientCode, reason: `Testflow payout for ${locked.name}` });
    if (sent.status === 'otp') {
      logger.error?.({ reference: row.reference }, 'Paystack wants an OTP for transfers: turn it off for API transfers');
      throw new AppError(503, 'TRANSFER_UNAVAILABLE', 'Withdrawals are temporarily unavailable. Please contact support.');
    }
    const done = sent.status === 'success';
    const updated = await settleAs(row.reference, ['pending'], {
      status: done ? 'success' : 'processing',
      transferCode: sent.transferCode,
      ...(done ? { completedAt: new Date() } : {}),
    });
    await notify(orgId, done ? 'success' : 'requested', updated ?? row);
    return view(updated ?? row);
  } catch (error) {
    const failed = await settleAs(row.reference, ['pending'], { status: 'failed', failureReason: error.message?.slice(0, 200) ?? 'Transfer failed', completedAt: new Date() });
    if (failed) await notify(orgId, 'failed', failed);
    throw error;
  }
};

/** Paystack's transfer.success / transfer.failed / transfer.reversed. Safe to receive twice. */
export const handleTransferWebhook = async (rawBody, signature, body) => {
  if (!verifyPaystackSignature(rawBody, signature)) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid payment signature.');
  const type = body?.event;
  const reference = body?.data?.reference;
  if (!reference || !String(type).startsWith('transfer.')) return { ignored: true };

  if (type === 'transfer.success') {
    const w = await settleAs(reference, IN_FLIGHT, { status: 'success', completedAt: new Date(), failureReason: null });
    if (w) await notify(w.organization, 'success', w);
    return { handled: true, status: w ? 'success' : 'unchanged' };
  }
  if (type === 'transfer.failed' || type === 'transfer.reversed') {
    const reason = String(body.data.reason ?? body.data.gateway_response ?? 'The bank did not accept the transfer.').slice(0, 200);
    const w = await settleAs(reference, [...IN_FLIGHT, 'success'], { status: 'failed', failureReason: reason, completedAt: new Date() });
    if (w) await notify(w.organization, 'failed', w);
    return { handled: true, status: w ? 'failed' : 'unchanged' };
  }
  return { ignored: true };
};
