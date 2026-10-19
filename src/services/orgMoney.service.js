import mongoose from 'mongoose';
import { Organization } from '../models/Organization.js';
import { OrgPayment } from '../models/OrgPayment.js';
import { Settings } from '../models/Settings.js';
import { AppError } from '../utils/AppError.js';
import { paystackConfigured, listPaystackBanks, resolvePaystackAccount, upsertPaystackSubaccount } from './orgPaystack.service.js';
import { entitlementsFor } from './entitlements.js';

/**
 * The organisation's money: the bank list its owner picks a payout account from, the split that
 * Paystack applies, and the read models behind the Payments screen.
 *
 * Testflow's share (`platformPercent`) lives on the organisation and is server-side only: the
 * console displays it but can never send it. When Paystack is configured the bank list and the
 * account resolve come from it; without a key the bank list falls back to a static one so the
 * screen still renders, and the two write paths refuse with `PAYMENT_NOT_CONFIGURED`.
 */

export const DEFAULT_PLATFORM_PERCENT = 5;

/**
 * Testflow's share, from the super-admin setting. It is never read from a request body and never
 * sent by the console; the payout view only reports it.
 */
export const getPlatformPercent = async () => {
  const settings = await Settings.getInstance();
  const value = Number(settings.platformPercent);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_PLATFORM_PERCENT;
};

/**
 * A static fallback for the bank dropdown. Codes follow Paystack's; when a key is present the live
 * list replaces this, so a new bank never needs a deploy.
 */
export const FALLBACK_BANKS = Object.freeze([
  { code: '044', name: 'Access Bank' },
  { code: '063', name: 'Access Bank (Diamond)' },
  { code: '035A', name: 'ALAT by WEMA' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank (FCMB)' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '058', name: 'Guaranty Trust Bank (GTBank)' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '50211', name: 'Kuda Bank' },
  { code: '50515', name: 'Moniepoint MFB' },
  { code: '526', name: 'Parallex Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'Suntrust Bank' },
  { code: '302', name: 'TAJBank' },
  { code: '102', name: 'Titan Trust Bank' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
]);

let bankCache = null;

export const listBanks = async () => {
  if (bankCache) return bankCache;
  if (!paystackConfigured()) return { banks: FALLBACK_BANKS, source: 'static' };
  try {
    const banks = await listPaystackBanks();
    bankCache = banks;
    return { banks, source: 'paystack' };
  } catch {
    // A provider hiccup must not empty the dropdown.
    return { banks: FALLBACK_BANKS, source: 'static' };
  }
};

export const toPayoutView = (payout, platformPercent = null) => ({
  bankCode: payout?.bankCode ?? null,
  accountNumber: payout?.accountNumber ?? null,
  accountName: payout?.accountName ?? null,
  businessName: payout?.businessName ?? null,
  status: payout?.status ?? 'none',
  subaccountCode: payout?.subaccountCode ?? null,
  // The live setting wins over an old row; the stored value is only a fallback for old records.
  platformPercent: platformPercent ?? payout?.platformPercent ?? DEFAULT_PLATFORM_PERCENT,
});

export const verifyPayoutAccount = async ({ bankCode, accountNumber }) => {
  const resolved = await resolvePaystackAccount({ bankCode, accountNumber });
  return { accountName: resolved.accountName, bankCode, accountNumber };
};

/**
 * Save the payout account: resolve it once more (so a bad number cannot be stored), then create or
 * update the Paystack subaccount and record the result on the organisation.
 */
export const savePayout = async (org, { bankCode, accountNumber, businessName }) => {
  const ent = await entitlementsFor(org._id);
  if (!ent.paidExams) {
    const error = new AppError(402, 'PLAN_REQUIRED', 'Receiving payments for exams is part of the Studio plan.');
    error.details = { feature: 'paid_exams', requiredPlan: 'studio' };
    throw error;
  }
  if (!paystackConfigured()) {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payments are not configured yet.');
  }
  const percent = await getPlatformPercent();
  const resolved = await resolvePaystackAccount({ bankCode, accountNumber });
  const sub = await upsertPaystackSubaccount({
    businessName: businessName ?? org.name,
    bankCode,
    accountNumber,
    percentageCharge: percent,
    existingCode: org.payout?.subaccountCode ?? null,
  });

  const updated = await Organization.findOneAndUpdate(
    { _id: org._id },
    {
      $set: {
        payout: {
          bankCode,
          accountNumber,
          accountName: resolved.accountName,
          businessName: businessName ?? org.name,
          status: 'active',
          subaccountCode: sub.subaccountCode,
          platformPercent: percent,
        },
      },
    },
    { new: true, runValidators: true },
  ).lean();

  return toPayoutView(updated.payout, percent);
};

/** The last 30 days of settled payments, for the chart, and the lifetime totals. */
export const getEarnings = async (orgId) => {
  const oid = new mongoose.Types.ObjectId(String(orgId));
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalsAgg, seriesAgg] = await Promise.all([
    OrgPayment.aggregate([
      { $match: { organization: oid, status: 'paid' } },
      { $group: { _id: null, grossKobo: { $sum: '$grossKobo' }, orgShareKobo: { $sum: '$orgShareKobo' }, platformFeeKobo: { $sum: '$platformFeeKobo' } } },
    ]),
    OrgPayment.aggregate([
      { $match: { organization: oid, status: 'paid', paidAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, grossKobo: { $sum: '$grossKobo' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const totals = totalsAgg[0] ?? { grossKobo: 0, orgShareKobo: 0, platformFeeKobo: 0 };
  const series = seriesAgg.map((row) => ({ date: row._id, grossKobo: row.grossKobo }));

  return {
    totals: {
      grossKobo: totals.grossKobo ?? 0,
      orgShareKobo: totals.orgShareKobo ?? 0,
      platformFeeKobo: totals.platformFeeKobo ?? 0,
      last30d: series.reduce((sum, row) => sum + row.grossKobo, 0),
    },
    series,
  };
};

export const listOrgPayments = async (orgId, { page = 1, limit = 20, status, from, to } = {}) => {
  const where = { organization: orgId };
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.$gte = new Date(from);
    if (to) where.createdAt.$lte = new Date(to);
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    OrgPayment.find(where)
      .sort({ paidAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('student', 'fullName')
      .lean(),
    OrgPayment.countDocuments(where),
  ]);
  return {
    items: rows.map((p) => ({
      id: String(p._id),
      item: p.itemTitle || p.item,
      itemType: p.item,
      itemRef: p.itemRef ?? null,
      reference: p.reference,
      studentName: p.student?.fullName ?? p.studentName ?? null,
      currency: p.currency,
      grossKobo: p.grossKobo,
      platformFeeKobo: p.platformFeeKobo,
      orgShareKobo: p.orgShareKobo,
      paystackFeeKobo: p.paystackFeeKobo,
      status: p.status,
      paidAt: p.paidAt ?? p.createdAt ?? null,
    })),
    page,
    limit,
    total,
  };
};

/**
 * Record a settled student payment with the split frozen onto it. The student-side purchase flow
 * (which calls this once Paystack has confirmed) is not part of this console slice, but the shape
 * it writes is, so the Payments screen has real rows the moment that flow lands.
 */
export const recordOrgPayment = async ({
  organizationId, studentId = null, item, itemRef = null, itemTitle = '', reference, currency = 'NGN',
  grossKobo, platformPercent, paystackFeeKobo = 0, status = 'paid', paidAt = new Date(),
}) => {
  const percent = Number(platformPercent ?? (await getPlatformPercent()));
  const platformFeeKobo = Math.round((grossKobo * percent) / 100);
  const orgShareKobo = Math.max(0, grossKobo - platformFeeKobo - paystackFeeKobo);
  return OrgPayment.findOneAndUpdate(
    { reference },
    {
      $set: {
        organization: organizationId,
        student: studentId,
        item,
        itemRef,
        itemTitle,
        currency,
        grossKobo,
        platformPercent: percent,
        platformFeeKobo,
        orgShareKobo,
        paystackFeeKobo,
        status,
        paidAt,
      },
      $setOnInsert: { provider: 'paystack' },
    },
    { upsert: true, new: true, runValidators: true },
  );
};
