import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  registerSchema,
  loginSchema,
  emailOnlySchema,
  verifyEmailSchema,
  resetPasswordSchema,
} from '../validators/auth.schema.js';

const router = Router();

// Rate limiting removed from auth routes per request. Re-add a lenient limiter
// on register/login/forgot if brute-force protection is needed later.
router.post('/register', validate(registerSchema), auth.register);
router.post('/login', validate(loginSchema), auth.login);
router.post('/logout', authenticate, auth.logout);
router.post('/refresh', auth.refresh);
router.get('/me', authenticate, auth.me);
router.post('/verify-email', validate(verifyEmailSchema), auth.verifyEmail);
router.post('/resend-verification', validate(emailOnlySchema), auth.resendVerification);
router.post('/forgot-password', validate(emailOnlySchema), auth.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), auth.resetPassword);

router.patch('/profile', authenticate, auth.updateProfile);
router.post('/change-password', authenticate, auth.changePassword);

export default router;
