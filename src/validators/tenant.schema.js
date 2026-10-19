import { z } from 'zod';

/**
 * The tenant site API (section 8 of the requirements doc): the calls the frontend makes when it is
 * opened on an organisation's own address. The organisation itself is never in the path; it comes
 * from the `X-Tenant-Host` header, which the resolver turns into `req.tenant`.
 */

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters.').max(200);
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const tenantRegisterSchema = z.object({
  body: z
    .object({
      fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
      email,
      password,
    })
    .strict(),
});

export const tenantLoginSchema = z.object({
  body: z.object({ email, password: z.string().min(1).max(200) }).strict(),
});

export const tenantExamParamSchema = z.object({
  params: z.object({ examId: objectId }).strict(),
});

export const tenantStartExamSchema = z.object({
  params: z.object({ examId: objectId }).strict(),
  body: z.object({ accessCode: z.string().trim().max(20).optional() }).strict().optional(),
});

export const tenantAttemptParamSchema = z.object({
  params: z.object({ attemptId: objectId }).strict(),
});

export const tenantAnswerSchema = z.object({
  params: z.object({ attemptId: objectId }).strict(),
  body: z
    .object({
      questionId: objectId,
      selectedIndex: z.number().int().min(0).max(5).nullable(),
    })
    .strict(),
});

export const tenantResultsQuerySchema = z.object({ query: pageQuery.strict() });

export const tenantCheckoutSchema = z.object({
  params: z.object({ examId: objectId }).strict(),
  body: z.object({ idempotencyKey: z.string().trim().min(1).max(120).optional() }).strict().optional(),
});

export const tenantVerifyPaymentSchema = z.object({
  query: z.object({ reference: z.string().trim().min(1).max(128) }).strict(),
});

export const tenantFlagSchema = z.object({
  params: z.object({ questionId: objectId }).strict(),
  body: z
    .object({
      reason: z.enum(['wrong_answer', 'unclear', 'typo', 'other']).optional(),
      note: z.string().trim().max(500).optional(),
      attemptId: objectId.optional(),
    })
    .strict(),
});
