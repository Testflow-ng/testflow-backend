import { z } from 'zod';
import { PRODUCT_KEYS } from '../utils/identity.js';
import { CODE_CHALLENGE_RE, CODE_VERIFIER_RE } from '../utils/pkce.js';

const email = z.string().trim().toLowerCase().email().max(254);
const product = z.enum(PRODUCT_KEYS);
export const profileInput = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  organizationName: z.string().trim().min(2).max(120).optional(),
  contactPhone: z.string().trim().max(20).optional(),
}).strict();

export const membershipSchema = z.object({
  body: z.object({
    product,
    profile: profileInput.optional(),
    // Only when the caller has no session: prove ownership of the account.
    email: email.optional(),
    password: z.string().min(1).max(72).optional(),
  }).strict(),
});
export const switchProductSchema = z.object({ body: z.object({ product }).strict() });

export const oauthAuthorizeSchema = z.object({
  body: z.object({
    clientId: z.string().min(1).max(60),
    redirectUri: z.string().url().max(2000),
    codeChallenge: z.string().regex(CODE_CHALLENGE_RE, 'Invalid code challenge'),
    codeChallengeMethod: z.literal('S256'),
    state: z.string().max(200).optional(),
    product: product.optional(),
  }).strict(),
});
export const oauthTokenSchema = z.object({
  body: z.object({
    grantType: z.literal('authorization_code'),
    code: z.string().min(20).max(200),
    codeVerifier: z.string().regex(CODE_VERIFIER_RE, 'Invalid code verifier'),
    clientId: z.string().min(1).max(60),
    redirectUri: z.string().url().max(2000),
  }).strict(),
});
