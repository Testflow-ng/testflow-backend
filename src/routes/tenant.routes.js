import { Router } from 'express';
import * as tenant from '../controllers/tenant.controller.js';
import { resolveTenant } from '../middleware/resolveTenant.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  tenantRegisterSchema,
  tenantLoginSchema,
  tenantStartExamSchema,
  tenantAttemptParamSchema,
  tenantAnswerSchema,
  tenantResultsQuerySchema,
  tenantCheckoutSchema,
  tenantVerifyPaymentSchema,
  tenantFlagSchema,
} from '../validators/tenant.schema.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';

const router = Router();

const flagLimit = sharedRateLimit({
  name: 'tenant-question-flag',
  windowMs: 60_000,
  max: 20,
  key: (req) => String(req.user?._id ?? req.ip),
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

export default router;
