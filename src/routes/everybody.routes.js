import { Router } from 'express';
import * as org from '../controllers/organization.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import {
  createOrgSchema,
  updateOrgSchema,
  orgParamsSchema,
  memberParamsSchema,
  listOrgsQuerySchema,
  listMembersQuerySchema,
  inviteSchema,
  updateMemberSchema,
  acceptInviteSchema,
} from '../validators/everybody.schema.js';

const router = Router();

router.post('/organizations', authenticate, validate(createOrgSchema), org.create);
router.get('/organizations', authenticate, validate(listOrgsQuerySchema), org.listMine);

router.get('/organizations/:organizationId', authenticate, validate(orgParamsSchema), requireOrgRole(), org.get);
router.patch(
  '/organizations/:organizationId',
  authenticate,
  validate(updateOrgSchema),
  requireOrgRole('owner', 'admin'),
  org.patch,
);

router.get(
  '/organizations/:organizationId/members',
  authenticate,
  validate(listMembersQuerySchema),
  requireOrgRole('owner', 'admin'),
  org.listMembers,
);
router.post(
  '/organizations/:organizationId/invitations',
  authenticate,
  validate(inviteSchema),
  requireOrgRole('owner', 'admin'),
  org.invite,
);
router.patch(
  '/organizations/:organizationId/members/:memberId',
  authenticate,
  validate(updateMemberSchema),
  requireOrgRole('owner', 'admin'),
  org.patchMember,
);
router.delete(
  '/organizations/:organizationId/members/:memberId',
  authenticate,
  validate(memberParamsSchema),
  requireOrgRole('owner', 'admin'),
  org.deleteMember,
);

router.post('/invitations/accept', authenticate, validate(acceptInviteSchema), org.acceptInvite);

export default router;
