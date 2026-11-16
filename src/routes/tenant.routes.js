import { Router } from 'express';
import * as tenant from '../controllers/tenant.controller.js';
import { resolveTenant } from '../middleware/resolveTenant.js';
import { tenantAuthenticate as authenticate } from '../middleware/tenantAuthenticate.js';
import { validate } from '../middleware/validate.js';
import {
  tenantRegisterSchema,
  tenantLoginSchema,
  tenantTestflowCompleteSchema,
  tenantGoogleCompleteSchema,
  tenantStartExamSchema,
  tenantAttemptParamSchema,
  tenantAnswerSchema,
  tenantResultsQuerySchema,
  tenantCheckoutSchema,
  tenantVerifyPaymentSchema,
  tenantFlagSchema,
  tenantBookListSchema,
  tenantBookParamSchema,
  tenantBookCheckoutSchema,
} from '../validators/tenant.schema.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';

const router = Router();

const refreshLimit = sharedRateLimit({ name: 'tenant-refresh', windowMs: 15 * 60_000, max: 120, key: (req) => req.ip });

const flagLimit = sharedRateLimit({
  name: 'tenant-question-flag',
  windowMs: 60_000,
  max: 20,
  key: (req) => String(req.user?._id ?? req.ip),
});

// Signing a book URL is cheap, but a signed link is what a student forwards; limit per student and
// per book so one account cannot turn the shelf into a signing oracle.
const bookDownloadLimit = sharedRateLimit({
  name: 'tenant-book-download',
  windowMs: 60 * 60 * 1000,
  max: 60,
  key: (req) => `${req.user?._id ?? req.ip}:${req.params?.bookId ?? ''}`,
});

// The organisation's public face and the share image. Crawlers read these without a session.
router.get('/site', resolveTenant, tenant.getSite);
router.get('/site/og.png', resolveTenant, tenant.getSiteCard);
router.get('/site/page', tenant.getSiteHtml); // resolves the host itself; sends an HTML 404
router.get('/site/pages/:page', resolveTenant, tenant.getSitePage);

// The student account calls. `resolveTenant` must run first: the organisation is the address.
router.get('/auth/me', resolveTenant, authenticate, tenant.me);
router.post('/auth/register', resolveTenant, validate(tenantRegisterSchema), tenant.register);
router.post('/auth/login', resolveTenant, validate(tenantLoginSchema), tenant.login);
router.post('/auth/google/complete', resolveTenant, validate(tenantGoogleCompleteSchema), tenant.googleComplete);
router.post('/auth/testflow/complete', resolveTenant, validate(tenantTestflowCompleteSchema), tenant.testflowComplete);
router.post('/auth/refresh', refreshLimit, tenant.refresh);
router.post('/auth/logout', tenant.logout);

// The organisation's published exams, for its own students.
router.get('/exams', resolveTenant, authenticate, tenant.getExams);

// Payments. The webhook is server-to-server: no host, no session, signature only.
router.post('/payments/webhook', tenant.paymentWebhook);

// Taking an exam. The server owns the clock; the student's page never decides time or scores.
router.post('/exams/:examId/checkout', resolveTenant, authenticate, validate(tenantCheckoutSchema), tenant.checkoutExam);
router.get('/payments/verify', resolveTenant, authenticate, validate(tenantVerifyPaymentSchema), tenant.verifyPayment);
router.post('/exams/:examId/start', resolveTenant, authenticate, validate(tenantStartExamSchema), tenant.startExam);
router.patch('/attempts/:attemptId/answers', resolveTenant, authenticate, validate(tenantAnswerSchema), tenant.saveAnswer);
router.post('/attempts/:attemptId/submit', resolveTenant, authenticate, validate(tenantAttemptParamSchema), tenant.submitAttempt);

// Results and corrections.
router.get('/results', resolveTenant, authenticate, validate(tenantResultsQuerySchema), tenant.getResults);
router.get('/results/:attemptId', resolveTenant, authenticate, validate(tenantAttemptParamSchema), tenant.getResult);

// Announcements and question reports.
router.get('/announcements', resolveTenant, authenticate, tenant.getAnnouncements);
router.post('/questions/:questionId/flag', resolveTenant, authenticate, validate(tenantFlagSchema), flagLimit, tenant.flagQuestion);

// The organisation's own Library: its shelf, its book detail, the signed download and the purchase
// of a priced book. Browsing needs a session and an active membership; the price gate lives in the
// service, next to the two functions that hand out the file.
router.get('/library/books', resolveTenant, authenticate, validate(tenantBookListSchema), tenant.getLibraryBooks);
router.get('/library/books/:bookId', resolveTenant, authenticate, validate(tenantBookParamSchema), tenant.getLibraryBook);
router.get('/library/books/:bookId/download', resolveTenant, authenticate, bookDownloadLimit, validate(tenantBookParamSchema), tenant.downloadLibraryBook);
router.post('/library/books/:bookId/checkout', resolveTenant, authenticate, validate(tenantBookCheckoutSchema), tenant.checkoutBook);

export default router;
