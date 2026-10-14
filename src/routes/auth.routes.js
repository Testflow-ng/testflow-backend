import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  emailOnlySchema,
  verifyEmailSchema,
  resetPasswordSchema,
} from '../validators/auth.schema.js';
import { membershipSchema, switchProductSchema, oauthAuthorizeSchema, oauthTokenSchema } from '../validators/identity.schema.js';

const router = Router();

// Global (all products) rate limits, shared across API instances.
const ip = (req) => req.ip;
const ipAndEmail = (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`;
const WINDOW = 15 * 60 * 1000;
const loginLimiter = sharedRateLimit({ name: 'auth-login', windowMs: WINDOW, max: 10, key: ipAndEmail });
const loginIpLimiter = sharedRateLimit({ name: 'auth-login-ip', windowMs: WINDOW, max: 50, key: ip });
const registerLimiter = sharedRateLimit({ name: 'auth-register', windowMs: 60 * 60 * 1000, max: 15, key: ip });
const emailLimiter = sharedRateLimit({ name: 'auth-email', windowMs: 60 * 60 * 1000, max: 6, key: ipAndEmail });
const tokenLimiter = sharedRateLimit({ name: 'auth-token', windowMs: WINDOW, max: 5, key: (r) => `${r.ip}:${r.cookies?.tf_refresh ? 'r' : 'n'}` });
const exchangeLimiter = sharedRateLimit({ name: 'auth-oauth', windowMs: WINDOW, max: 30, key: ip });

/** Use the session when present; otherwise let the handler fall back to email+password. */
const optionalAuthenticate = (req, res, next) =>
  (req.cookies?.tf_access || /^Bearer /i.test(req.get('authorization') ?? '') ? authenticate(req, res, next) : next());

router.post('/register', registerLimiter, validate(registerSchema), auth.register);
router.post('/login', loginIpLimiter, loginLimiter, validate(loginSchema), auth.login);
router.post('/logout', authenticate, auth.logout);
router.post('/refresh', tokenLimiter, auth.refresh);
router.get('/me', authenticate, auth.me);
router.post('/memberships', loginIpLimiter, optionalAuthenticate, validate(membershipSchema), auth.addMembership);
router.post('/switch-product', authenticate, validate(switchProductSchema), auth.switchProduct);
router.post('/oauth/authorize', exchangeLimiter, authenticate, validate(oauthAuthorizeSchema), auth.oauthAuthorize);
router.post('/oauth/token', exchangeLimiter, validate(oauthTokenSchema), auth.oauthToken);
router.patch('/username', authenticate, auth.setUsername);
router.post('/verify-email', emailLimiter, validate(verifyEmailSchema), auth.verifyEmail);
router.post('/resend-verification', emailLimiter, validate(emailOnlySchema), auth.resendVerification);
router.post('/forgot-password', emailLimiter, validate(emailOnlySchema), auth.forgotPassword);
router.post('/reset-password', emailLimiter, validate(resetPasswordSchema), auth.resetPassword);

router.patch('/profile', authenticate, auth.updateProfile);
router.patch('/migrate', authenticate, auth.migrateToUniversity);
router.patch('/utme-data', authenticate, auth.updateUtmeData);
router.post('/change-password', authenticate, auth.changePassword);

export default router;
