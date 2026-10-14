import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Subdomain must be at least 3 characters.')
  .max(30, 'Subdomain must be at most 30 characters.')
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and single hyphens.')
  .refine((v) => !v.includes('--'), 'Consecutive hyphens are not allowed.');

const email = z.string().trim().toLowerCase().email().max(254);
const orgName = z.string().trim().min(2).max(120);
const token = z.string().min(1).max(256);

export const RESERVED_SLUGS = Object.freeze([
  'www', 'api', 'admin', 'ads', 'app', 'mail', 'cdn', 'static',
  'everybody', 'everyone', 'docs', 'status', 'support', 'billing', 'login',
]);

export const orgParamsSchema = z.object({ params: z.object({ organizationId: objectId }).strict() });

export const memberParamsSchema = z.object({
  params: z.object({ organizationId: objectId, memberId: objectId }).strict(),
});

export const createOrgSchema = z.object({
  body: z
    .object({
      name: orgName,
      slug: slug.optional(),
      contactEmail: email.optional(),
      timezone: z.string().trim().max(64).optional(),
    })
    .strict(),
});

export const updateOrgSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      name: orgName.optional(),
      contactEmail: email.optional(),
      timezone: z.string().trim().max(64).optional(),
    })
    .strict(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listOrgsQuerySchema = z.object({ query: pageQuery.strict() });
export const listMembersQuerySchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  query: pageQuery.extend({ role: z.enum(['owner', 'admin', 'examiner', 'student']).optional() }).strict(),
});

export const inviteSchema = z.object({
  params: z.object({ organizationId: objectId }).strict(),
  body: z
    .object({
      email,
      role: z.enum(['admin', 'examiner', 'student']),
    })
    .strict(),
});

export const updateMemberSchema = z.object({
  params: z.object({ organizationId: objectId, memberId: objectId }).strict(),
  body: z
    .object({
      role: z.enum(['admin', 'examiner', 'student']).optional(),
      status: z.enum(['active', 'suspended', 'removed']).optional(),
    })
    .strict()
    .refine((b) => b.role !== undefined || b.status !== undefined, 'Nothing to update.'),
});

export const acceptInviteSchema = z.object({
  body: z.object({ token }).strict(),
});
