import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authenticate.js';
import { requireMembership } from '../middleware/requireMembership.js';
import { validate } from '../middleware/validate.js';
import { rateLimit, sharedRateLimit } from '../middleware/rateLimit.js';
import { AppError } from '../utils/AppError.js';
import * as ads from '../controllers/ads.controller.js';
import * as serving from '../controllers/adServing.controller.js';
import * as s from '../validators/ads.schema.js';

const router = Router();
const advertiser = [authenticate, requireMembership('ads')];

// In-memory (never written to disk); hard ceiling 2 MB, one file, field "image".
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } });
const imageUpload = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'IMAGE_TOO_LARGE', 'Image must be at most 2 MB.'));
    return next(new AppError(422, 'INVALID_UPLOAD', 'Invalid upload. Send a single image in the "image" field.'));
  });

// Shared across instances (MongoDB): auth, uploads, checkout. In-memory (per process) for high-volume student calls.
const authLimiter = sharedRateLimit({ name: 'ads-auth', windowMs: 15 * 60 * 1000, max: 20 });
const uploadLimiter = sharedRateLimit({ name: 'ads-upload', windowMs: 60 * 60 * 1000, max: 40, key: (r) => String(r.user?._id ?? r.ip) });
const checkoutLimiter = sharedRateLimit({ name: 'ads-checkout', windowMs: 60 * 60 * 1000, max: 30, key: (r) => String(r.user?._id ?? r.ip) });
const serveLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, key: (r) => String(r.user?._id ?? r.ip) });
const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, key: (r) => String(r.user?._id ?? r.ip) });

// --- Public / provider-facing ---
router.get('/pricing', ads.pricing);
router.post('/payments/webhook', ads.webhook); // HMAC-verified over the raw body

// --- Advertiser auth & profile (login/logout/refresh also work via /api/auth/*) ---
router.post('/auth/register', authLimiter, validate(s.registerAdvertiserSchema), ads.register);
router.post('/auth/login', authLimiter, validate(s.loginSchema), ads.login);
router.get('/auth/me', ...advertiser, ads.me);
router.patch('/profile', ...advertiser, validate(s.profileSchema), ads.updateProfile);

// --- Assets ---
router.post('/assets/images', ...advertiser, uploadLimiter, imageUpload, ads.uploadImage);
router.delete('/assets/:id', ...advertiser, validate(s.idParam), ads.deleteAsset);

// --- Campaigns ---
router.get('/dashboard', ...advertiser, ads.dashboard);
router.get('/campaigns', ...advertiser, validate(s.listCampaignsSchema), ads.list);
router.post('/campaigns', ...advertiser, validate(s.createCampaignSchema), ads.create);
router.get('/campaigns/:id', ...advertiser, validate(s.idParam), ads.get);
router.patch('/campaigns/:id', ...advertiser, validate(s.updateCampaignSchema), ads.update);
router.delete('/campaigns/:id', ...advertiser, validate(s.idParam), ads.remove);
router.post('/campaigns/:id/resubmit', ...advertiser, validate(s.idParam), ads.resubmit);
router.post('/campaigns/:id/archive', ...advertiser, validate(s.idParam), ads.archive);
router.post('/campaigns/:id/republish', ...advertiser, validate(s.idParam), ads.republish);
router.get('/campaigns/:id/analytics', ...advertiser, validate(s.analyticsSchema), ads.campaignAnalytics);

// --- Checkout & payments ---
router.post('/checkout/quote', ...advertiser, validate(s.quoteSchema), ads.quote);
router.post('/checkout', ...advertiser, checkoutLimiter, validate(s.checkoutSchema), ads.checkout);
router.get('/checkout/verify', ...advertiser, validate(s.verifyPaymentSchema), ads.verifyPayment);
router.post('/checkout/:id/cancel', ...advertiser, validate(s.idParam), ads.cancelCheckout);
router.get('/payments', ...advertiser, ads.myPayments);

// --- Student-side serving (existing student auth) ---
router.post('/serve', authenticate, requireMembership('student'), serveLimiter, validate(s.serveSchema), serving.serve);
router.post('/events', authenticate, requireMembership('student'), eventLimiter, validate(s.eventSchema), serving.event);

export default router;
