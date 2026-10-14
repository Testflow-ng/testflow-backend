import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as orgs from '../services/organization.service.js';
import { Subscription } from '../models/Subscription.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { recordAction } from '../services/audit.service.js';

export const create = asyncHandler(async (req, res) => {
  const org = await orgs.createOrganization(req.user, req.body, req);
  res.status(201).json({ organization: orgs.orgView(org), myRole: 'owner' });
});

export const listMine = asyncHandler(async (req, res) => {
  res.json(await orgs.listMyOrganizations(req.user._id, req.query));
});

export const get = asyncHandler(async (req, res) => {
  res.json({ organization: orgs.orgView(req.org), myRole: req.orgMembership.role });
});

export const patch = asyncHandler(async (req, res) => {
  const updated = await orgs.updateOrganization(req.org, req.body, req);
  res.json({ organization: orgs.orgView(updated) });
});

export const listMembers = asyncHandler(async (req, res) => {
  res.json(await orgs.listMembers(req.org._id, req.query));
});

export const invite = asyncHandler(async (req, res) => {
  const { invitation, token } = await orgs.inviteMember(req.org, req.orgMembership, req.body, req);
  // The token is emailed in production; returned once here so dev clients can complete the flow.
  res.status(201).json({
    invitation: { id: String(invitation._id), email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
    token,
  });
});

export const patchMember = asyncHandler(async (req, res) => {
  const updated = await orgs.updateMember(req.org, req.orgMembership, req.params.memberId, req.body, req);
  res.json({ member: orgs.memberView(updated) });
});

export const deleteMember = asyncHandler(async (req, res) => {
  const updated = await orgs.removeMember(req.org, req.orgMembership, req.params.memberId, req);
  res.json({ member: orgs.memberView(updated) });
});

export const acceptInvite = asyncHandler(async (req, res) => {
  const membership = await orgs.acceptInvitation(req.user, req.body.token, req);
  res.status(201).json({ member: orgs.memberView(membership), organizationId: String(membership.organization) });
});

export const createSubscription = asyncHandler(async (req, res) => {
  const org = req.org;
  const { planKey } = req.body;
  if (!planKey || !['pro', 'studio'].includes(planKey)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'planKey must be "pro" or "studio".');
  }
  // If org already has an active subscription, refuse.
  const existing = await Subscription.findOne({ organization: org._id, status: 'active' });
  if (existing) throw new AppError(409, 'SUBSCRIPTION_EXISTS', 'Organization already has an active subscription.');
  const planDef = await PlanDefinition.findOne({ key: planKey }).lean();
  if (!planDef) throw new AppError(400, 'PLAN_UNAVAILABLE', `Plan "${planKey}" is not defined.`);
  const sub = await Subscription.create({
    organization: org._id,
    planKey,
    planSnapshot: {
      priceMinor: planDef.priceMinor,
      currency: planDef.currency,
      entitlements: planDef.entitlements,
      status: 'pending',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial/grace placeholder
    },
  });
  await recordAction({
    actorId: req.user._id, action: 'SUBSCRIPTION_CREATE', targetId: org._id, targetType: 'Organization',
    metadata: { planKey }, req,
  });
  res.status(201).json({ subscription: orgs.subView(sub) });
});

export const listMySubs = asyncHandler(async (req, res) => {
  const subs = await Subscription.find({ organization: req.org._id })
    .populate('planKey')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ subscriptions: subs.map(s => ({ ...orgs.subView(s), myRole: req.orgMembership.role })) });
});

export const getSub = asyncHandler(async (req, res) => {
  const sub = await Subscription.findById(req.params.id)
    .populate('planKey')
    .lean();
  if (!sub || String(sub.organization) !== String(req.org._id)) throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  res.json({ subscription: orgs.subView(sub), myRole: req.orgMembership.role });
});

export const updateSub = asyncHandler(async (req, res) => {
  const { cancelAtPeriodEnd, planKey } = req.body;
  const sub = await Subscription.findOneAndUpdate(
    { _id: req.params.id, organization: req.org._id },
    { ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
      ...(planKey !== undefined ? { planKey, status: 'pending' } : {}) },
    { new: true, runValidators: true },
  ).lean();
  if (!sub || String(sub.organization) !== String(req.org._id)) throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  res.json({ subscription: orgs.subView(sub), myRole: req.orgMembership.role });
});

export const checkout = asyncHandler(async (req, res) => {
  const sub = await Subscription.findOne({ _id: req.params.id, organization: req.org._id }).lean();
  if (!sub) throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  // In v1 we return a Paystack checkout; provider must be configured.
  if (!process.env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Payment provider not configured.');
  const reference = `SUB-${sub._id.toString().slice(-6).toUpperCase()}`;
  const amountKobo = sub.planSnapshot.priceMinor;
  const authorizationUrl = `${process.env.CLIENT_URL}/subscription/pay?reference=${reference}`;
  await recordAction({
    actorId: req.user._id, action: 'SUBSCRIPTION_PAYMENT_VERIFIED', targetId: req.org._id, targetType: 'Organization',
    metadata: { reference, amountKobo }, req,
  });
  res.json({ paymentId: reference, reference, amountKobo, currency: 'NGN', authorizationUrl });
});

export const verify = asyncHandler(async (req, res) => {
  const ref = req.query.reference;
  if (!ref) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Reference required.');
  // Re-verify with provider (Paystack). In v1 we just mark it paid locally.
  const sub = await Subscription.findOne({ organization: req.org._id, status: 'pending' }).lean();
  if (!sub) throw new AppError(404, 'NOT_FOUND', 'No pending subscription to verify.');
  // Atomically claim: status != paid → paid
  const updated = await Subscription.findOneAndUpdate(
    { _id: sub._id, status: 'pending' },
    { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    { new: true },
  );
  if (!updated) throw new AppError(400, 'SUBSCRIPTION_EXISTS', 'Subscription already processed or not pending.');
  res.json({ subscription: orgs.subView(updated), entitlements: orgs.entitlementsFor(req.org._id) });
});
