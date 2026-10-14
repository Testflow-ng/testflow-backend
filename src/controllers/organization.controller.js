import { asyncHandler } from '../middleware/asyncHandler.js';
import * as orgs from '../services/organization.service.js';

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
