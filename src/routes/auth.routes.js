import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  emailOnlySchema,
  verifyEmailSchema,
  resetPasswordSchema,
} from '../validators/auth.schema.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/logout', authenticate, auth.logout);
router.post('/refresh', authLimiter, auth.refresh);
router.get('/me', authenticate, auth.me);
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), auth.verifyEmail);
router.post('/resend-verification', authLimiter, validate(emailOnlySchema), auth.resendVerification);
router.post('/forgot-password', authLimiter, validate(emailOnlySchema), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), auth.resetPassword);

router.patch('/profile', authenticate, auth.updateProfile);
router.post('/change-password', authenticate, auth.changePassword);

export default router;
