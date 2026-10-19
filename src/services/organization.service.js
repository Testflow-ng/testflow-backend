import crypto from 'node:crypto';
import { Organization } from '../models/Organization.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { OrgInvitation } from '../models/OrgInvitation.js';
import { AppError } from '../utils/AppError.js';
import { scoped } from '../utils/orgScope.js';
import { generateToken, hashToken } from '../utils/tokens.js';
import { recordAction } from './audit.service.js';
import { RESERVED_SLUGS } from '../validators/everybody.schema.js';

// Re-exported so the organization controller reaches every subscription-side helper through one
// namespace (`orgs.subView`, `orgs.entitlementsFor`) instead of reaching into two services.
export { entitlementsFor } from './entitlements.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 30);

const timingSafeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

export const orgView = (org) => ({
  id: String(org._id ?? org.id),
  name: org.name,
  slug: org.slug,
  status: org.status,
  contactEmail: org.contactEmail ?? null,
  timezone: org.timezone ?? null,
  createdAt: org.createdAt ?? null,
  updatedAt: org.updatedAt ?? null,
});

export const memberView = (m) => ({
  id: String(m._id),
  user: m.user,
  role: m.role,
  status: m.status,
  studentRef: m.studentRef ?? null,
  joinedAt: m.joinedAt ?? null,
});

/**
 * The subscription shape the console reads. `reference` is the same string `checkout` hands the
 * provider, so a client can start a payment and then hand the reference straight back to `verify`.
 */
export const subView = (sub) => ({
  id: String(sub._id ?? sub.id),
  organizationId: String(sub.organization),
  planKey: sub.planKey,
  status: sub.status,
  planSnapshot: sub.planSnapshot ?? null,
  currentPeriodStart: sub.currentPeriodStart ?? null,
  currentPeriodEnd: sub.currentPeriodEnd ?? null,
  cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
  pendingPlanKey: sub.pendingPlanKey ?? null,
  provider: sub.provider ?? null,
  reference: sub.providerReference ?? `SUB-${String(sub._id).slice(-6).toUpperCase()}`,
  createdAt: sub.createdAt ?? null,
});

export const createOrganization = async (user, { name, slug, contactEmail, timezone }, req) => {
  const finalSlug = (slug ?? slugify(name)).toLowerCase();
  if (RESERVED_SLUGS.includes(finalSlug)) {
    throw new AppError(409, 'SUBDOMAIN_RESERVED', 'That subdomain is reserved.');
  }
  let org;
  try {
    org = await Organization.create({
      name: name.trim(),
      slug: finalSlug,
      ownerUser: user._id,
      ...(contactEmail ? { contactEmail } : {}),
      ...(timezone ? { timezone } : {}),
    });
  } catch (e) {
    if (e?.code === 11000) throw new AppError(409, 'SUBDOMAIN_TAKEN', 'That subdomain is already taken.');
    throw e;
  }
  try {
    await OrgMembership.create({ organization: org._id, user: user._id, role: 'owner', status: 'active' });
  } catch (e) {
    await Organization.deleteOne({ _id: org._id });
    if (e?.code === 11000) throw new AppError(409, 'SUBDOMAIN_TAKEN', 'That subdomain is already taken.');
    throw e;
  }
  await recordAction({
    actorId: user._id, action: 'ORG_CREATE', targetId: org._id, targetType: 'Organization',
    metadata: { slug: org.slug }, req,
  });
  return org;
};

export const listMyOrganizations = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const memberships = await OrgMembership.find({ user: userId, status: 'active' })
    .select('organization role status joinedAt')
    .populate('organization')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const total = await OrgMembership.countDocuments({ user: userId, status: 'active' });
  return {
    items: memberships.filter((m) => m.organization).map((m) => ({ ...orgView(m.organization), myRole: m.role })),
    page, limit, total,
  };
};

export const updateOrganization = async (org, { name, contactEmail, timezone }, req) => {
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (contactEmail !== undefined) patch.contactEmail = contactEmail;
  if (timezone !== undefined) patch.timezone = timezone;
  if (!Object.keys(patch).length) return org;
  const updated = await Organization.findOneAndUpdate(
    { _id: org._id, status: { $ne: 'closed' } }, { $set: patch }, { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(403, 'ORG_CLOSED', 'This organization is closed.');
  await recordAction({
    actorId: req?.user?._id, action: 'ORG_UPDATE', targetId: org._id, targetType: 'Organization',
    metadata: { fields: Object.keys(patch) }, req,
  });
  return updated;
};

export const listMembers = async (orgId, { page = 1, limit = 20, role } = {}) => {
  const q = scoped(OrgMembership, orgId);
  const filter = role ? { role, status: 'active' } : {};
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    q.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit).populate('user', 'fullName email').lean(),
    q.countDocuments(filter),
  ]);
  return { items: items.map(memberView), page, limit, total };
};

const canInvite = (callerRole, targetRole) => {
  if (callerRole === 'owner') return true;
  if (callerRole === 'admin') return targetRole !== 'admin';
  return false;
};

export const inviteMember = async (org, caller, { email, role }, req) => {
  if (!canInvite(caller.role, role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners can invite admins.');
  }
  const token = generateToken();
  try {
    const invitation = await OrgInvitation.create({
      organization: org._id,
      email: String(email).toLowerCase(),
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: caller.user ?? req?.user?._id,
    });
    await recordAction({
      actorId: req?.user?._id, action: 'ORG_INVITE', targetId: org._id, targetType: 'Organization',
      metadata: { emailHash: hashToken(String(email).toLowerCase()).slice(0, 16), role }, req,
    });
    return { invitation, token };
  } catch (e) {
    if (e?.code === 11000) throw new AppError(500, 'INVITE_FAILED', 'Could not create the invitation. Please try again.');
    throw e;
  }
};

export const updateMember = async (org, caller, memberId, { role, status }, req) => {
  const target = await OrgMembership.findOne({ _id: memberId, organization: org._id }).lean();
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  if (target.role === 'owner') throw new AppError(403, 'FORBIDDEN', 'The owner cannot be modified.');
  if (String(target.user) === String(caller.user ?? req?.user?._id)) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot change your own membership.');
  }
  if (role === 'admin' && caller.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only owners can assign the admin role.');
  }
  if (role === 'owner') throw new AppError(422, 'VALIDATION_ERROR', 'Ownership transfer is not supported yet.');
  const patch = {};
  if (role !== undefined) patch.role = role;
  if (status !== undefined) patch.status = status;
  const updated = await OrgMembership.findOneAndUpdate(
    { _id: memberId, organization: org._id }, { $set: patch }, { new: true, runValidators: true },
  ).lean();
  await recordAction({
    actorId: req?.user?._id, action: 'ORG_MEMBER_UPDATE', targetId: org._id, targetType: 'Organization',
    metadata: { memberId: String(memberId), ...patch }, req,
  });
  return updated;
};

export const removeMember = async (org, caller, memberId, req) =>
  updateMember(org, caller, memberId, { status: 'removed' }, req);

export const acceptInvitation = async (user, token, req) => {
  const invitation = await OrgInvitation.findOne({ tokenHash: hashToken(String(token)) });
  if (!invitation || invitation.expiresAt.getTime() < Date.now() || invitation.acceptedAt) {
    throw new AppError(400, 'INVITATION_INVALID', 'That invitation is invalid or expired.');
  }
  const userEmail = String(user.email).toLowerCase();
  if (!timingSafeEqual(userEmail, String(invitation.email).toLowerCase())) {
    throw new AppError(403, 'INVITATION_INVALID', 'That invitation was sent to a different email address.');
  }
  let membership;
  try {
    membership = await OrgMembership.create({
      organization: invitation.organization,
      user: user._id,
      role: invitation.role,
      status: 'active',
      invitedBy: invitation.invitedBy,
    });
  } catch (e) {
    if (e?.code === 11000) throw new AppError(409, 'ALREADY_MEMBER', 'You are already a member of this organization.');
    throw e;
  }
  invitation.acceptedAt = new Date();
  invitation.useCount += 1;
  await invitation.save();
  await recordAction({
    actorId: user._id, action: 'ORG_MEMBER_ADD', targetId: invitation.organization, targetType: 'Organization',
    metadata: { role: invitation.role }, req,
  });
  return membership;
};
