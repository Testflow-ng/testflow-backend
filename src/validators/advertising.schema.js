import { z } from 'zod';
import { STUDENT_PLAN_KEYS } from '../config/plans.js';
import { AD_CONSENT_VALUES } from '../config/advertising.js';
import { ENTITLEMENT_KEYS } from '../models/StudentEntitlement.js';

const planKey = z.enum([...STUDENT_PLAN_KEYS]);
const entitlementKey = z.enum([...ENTITLEMENT_KEYS]);
const userIdParam = z.object({ userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

/**
 * Eligibility query. Consent is an assertion from the page, never proof of it.
 * `placement` stays a string so an unregistered id is the service's `404 PLACEMENT_NOT_FOUND`
 * rather than a validator `422`: "that placement does not exist" is the honest answer.
 */
export const eligibilityQuerySchema = z.object({
  query: z
    .object({
      placement: z.string().trim().min(1).max(64),
      consent: z.enum([...AD_CONSENT_VALUES]).optional().default('unknown'),
    })
    .strict(),
});

export const checkoutSchema = z.object({
  body: z
    .object({
      planKey,
      idempotencyKey: z.string().trim().min(8).max(120).optional(),
    })
    .strict(),
});

export const statusQuerySchema = z.object({
  query: z
    .object({
      reference: z.string().trim().min(6).max(120).optional(),
    })
    .strict(),
});

export const cancelSchema = z.object({
  body: z.object({ reference: z.string().trim().min(6).max(120) }).strict(),
});

export const refundSchema = z.object({
  body: z
    .object({
      reference: z.string().trim().min(6).max(120),
      reason: z.string().trim().max(200).optional(),
    })
    .strict(),
});

/** Support tooling: an administrator can grant or revoke an entitlement by hand. */
export const grantEntitlementSchema = z.object({
  params: userIdParam,
  body: z
    .object({
      key: entitlementKey,
      // Omitted means "does not expire", which only an administrator may do.
      durationDays: z.coerce.number().int().min(1).max(3650).optional(),
    })
    .strict(),
});

export const revokeEntitlementSchema = z.object({
  params: userIdParam,
  body: z
    .object({
      key: entitlementKey,
      reason: z.string().trim().max(200).optional(),
    })
    .strict(),
});
