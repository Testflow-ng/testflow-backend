import crypto from 'node:crypto';
import { Subscription } from '../models/Subscription.js';
import { TrialClaim } from '../models/TrialClaim.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { PLAN_ENTITLEMENTS } from '../config/planFeatures.js';

/**
 * The free Studio trial every new organisation gets once.
 *
 * Abuse checks, all against hashed values: the same account owner, the same normalised email
 * (Gmail dots and +tags ignored), the same browser/device fingerprint, or more than
 * `MAX_PER_IP` trials from one network address in the window. Campus networks share an address,
 * so the IP rule allows a couple rather than one. A refused trial still gets a normal Free
 * organisation; nothing else about sign-up changes.
 */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN = 'studio';
const MAX_PER_IP = 2;
const IP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const salt = () => process.env.TRIAL_HASH_SALT || process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'testflow-trial';
const hash = (v) => (v ? crypto.createHmac('sha256', salt()).update(String(v)).digest('hex') : null);

export const normaliseEmail = (email) => {
  const [local = '', domain = ''] = String(email ?? '').trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
};

const clientIp = (req) => String(req?.ip ?? req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();

export const trialSignals = (user, req) => ({
  emailKey: normaliseEmail(user?.email),
  ipHash: hash(clientIp(req)),
  deviceHash: hash(req?.get?.('x-device-fp') || null),
});

/** Why this person cannot have a trial, or null when they can. */
export const trialRefusal = async (user, signals) => {
  if (await TrialClaim.exists({ user: user._id })) return 'user';
  if (signals.emailKey && (await TrialClaim.exists({ emailKey: signals.emailKey }))) return 'email';
  if (signals.deviceHash && (await TrialClaim.exists({ deviceHash: signals.deviceHash }))) return 'device';
  if (signals.ipHash) {
    const n = await TrialClaim.countDocuments({ ipHash: signals.ipHash, createdAt: { $gte: new Date(Date.now() - IP_WINDOW_MS) } });
    if (n >= MAX_PER_IP) return 'ip';
  }
  return null;
};

/** Give a brand-new organisation its trial when the checks pass. Never throws. */
export const grantTrialIfEligible = async ({ org, user, req }) => {
  try {
    const signals = trialSignals(user, req);
    const refusal = await trialRefusal(user, signals);
    if (refusal) return { granted: false, reason: refusal };
    const plan = await PlanDefinition.findOne({ key: TRIAL_PLAN }).lean();
    const now = new Date();
    const endsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    await Subscription.create({
      organization: org._id,
      planKey: TRIAL_PLAN,
      status: 'active',
      isTrial: true,
      trialEndsAt: endsAt,
      currentPeriodStart: now,
      currentPeriodEnd: endsAt,
      provider: 'none',
      planSnapshot: {
        priceMinor: 0,
        currency: 'NGN',
        entitlements: plan?.entitlements ?? { ...PLAN_ENTITLEMENTS[TRIAL_PLAN] },
      },
    });
    await TrialClaim.create({ organization: org._id, user: user._id, ...signals });
    return { granted: true, endsAt };
  } catch {
    return { granted: false, reason: 'error' };
  }
};

/** The trial block the console shows: null when there is no trial to talk about. */
export const trialView = (sub, now = new Date()) => {
  if (!sub?.isTrial || !sub.trialEndsAt) return null;
  const ms = new Date(sub.trialEndsAt).getTime() - now.getTime();
  return { active: ms > 0 && sub.status === 'active', endsAt: sub.trialEndsAt, daysLeft: Math.max(0, Math.ceil(ms / DAY_MS)) };
};
