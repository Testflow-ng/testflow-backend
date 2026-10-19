import { Router } from 'express';
import * as org from '../controllers/orgConsole.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { singleImage, singleImport } from '../middleware/uploadImage.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';
import {
  orgExamListSchema,
  orgExamCreateSchema,
  orgExamUpdateSchema,
  orgExamParamSchema,
  orgExamQuestionsSchema,
  orgExamResultsSchema,
  orgAttemptParamSchema,
  orgQuestionListSchema,
  orgQuestionCreateSchema,
  orgQuestionUpdateSchema,
  orgQuestionParamSchema,
  orgQuestionBulkSchema,
  orgQuestionAssetsSchema,
  orgQuestionImportSchema,
  orgQuestionImportTemplateSchema,
  orgBankListSchema,
  orgBankCreateSchema,
  orgBankUpdateSchema,
  orgBankParamSchema,
  orgBankQuestionsSchema,
  orgStudentsListSchema,
  orgStudentParamSchema,
  orgPostListSchema,
  orgPostCreateSchema,
  orgPostUpdateSchema,
  orgPostParamSchema,
  orgFlagListSchema,
  orgFlagUpdateSchema,
  orgBookListSchema,
  orgBookCreateSchema,
  orgBookUpdateSchema,
  orgBookParamSchema,
  orgPayoutVerifySchema,
  orgPayoutSaveSchema,
  orgEarningsSchema,
  orgPaymentsListSchema,
  orgDomainListSchema,
  checkSubdomainSchema,
  orgDomainAddSchema,
  orgDomainParamSchema,
  orgSubscriptionSchema,
  orgPlansSchema,
  orgSubscriptionPaymentsSchema,
} from '../validators/everybody.schema.js';

const router = Router();

const staff = requireOrgRole('owner', 'admin');

/** Image intake is cheap per request but expensive per byte; cap it per organiser. */
const imageLimit = sharedRateLimit({
  name: 'org-question-image',
  windowMs: 60_000,
  max: 30,
  key: (req) => String(req.user?._id ?? req.ip),
});

/** `requireOrgRole` reads the id from params; for a flat call it comes in the query. */
const orgFromQuery = (req, _res, next) => {
  req.params.organizationId = req.query.organizationId;
  next();
};

/* --- top-level console calls (no org in the path) --- */

router.get('/banks', authenticate, org.listBanks);
router.get('/plans', authenticate, validate(orgPlansSchema), org.listPlans);
router.get(
  '/subscription',
  authenticate,
  validate(orgSubscriptionSchema),
  orgFromQuery,
  staff,
  org.getSubscription,
);
router.get(
  '/payments',
  authenticate,
  validate(orgSubscriptionPaymentsSchema),
  orgFromQuery,
  staff,
  org.listSubscriptionPayments,
);

/* --- exams --- */

router.get('/organizations/:organizationId/exams', authenticate, validate(orgExamListSchema), staff, org.listExams);
router.post('/organizations/:organizationId/exams', authenticate, validate(orgExamCreateSchema), staff, org.createExam);
router.get('/organizations/:organizationId/exams/:examId', authenticate, validate(orgExamParamSchema), staff, org.getExam);
router.patch('/organizations/:organizationId/exams/:examId', authenticate, validate(orgExamUpdateSchema), staff, org.updateExam);
router.delete('/organizations/:organizationId/exams/:examId', authenticate, validate(orgExamParamSchema), staff, org.deleteExam);
router.get('/organizations/:organizationId/exams/:examId/questions', authenticate, validate(orgExamParamSchema), staff, org.getExamQuestions);
router.put('/organizations/:organizationId/exams/:examId/questions', authenticate, validate(orgExamQuestionsSchema), staff, org.setExamQuestions);
router.get('/organizations/:organizationId/exams/:examId/results', authenticate, validate(orgExamResultsSchema), staff, org.getExamResults);
router.get('/organizations/:organizationId/exams/:examId/results.csv', authenticate, validate(orgExamParamSchema), staff, org.downloadExamResults);
router.get('/organizations/:organizationId/attempts/:attemptId', authenticate, validate(orgAttemptParamSchema), staff, org.getAttempt);
router.post('/organizations/:organizationId/exams/:examId/publish', authenticate, validate(orgExamParamSchema), staff, org.publishExam);
router.post('/organizations/:organizationId/exams/:examId/unpublish', authenticate, validate(orgExamParamSchema), staff, org.unpublishExam);

/* --- questions --- */

router.get('/organizations/:organizationId/questions', authenticate, validate(orgQuestionListSchema), staff, org.listQuestions);
router.post('/organizations/:organizationId/questions/bulk', authenticate, validate(orgQuestionBulkSchema), staff, org.bulkQuestions);
router.get(
  '/organizations/:organizationId/questions/import/template',
  authenticate,
  validate(orgQuestionImportTemplateSchema),
  staff,
  org.downloadQuestionTemplate,
);
router.post(
  '/organizations/:organizationId/questions/import',
  authenticate,
  validate(orgQuestionImportSchema),
  staff,
  imageLimit,
  singleImport('file'),
  org.importQuestions,
);
router.post(
  '/organizations/:organizationId/questions/assets',
  authenticate,
  validate(orgQuestionAssetsSchema),
  staff,
  imageLimit,
  singleImage('file'),
  org.uploadQuestionImage,
);
router.post('/organizations/:organizationId/questions', authenticate, validate(orgQuestionCreateSchema), staff, org.createQuestion);
router.patch('/organizations/:organizationId/questions/:questionId', authenticate, validate(orgQuestionUpdateSchema), staff, org.updateQuestion);
router.delete('/organizations/:organizationId/questions/:questionId', authenticate, validate(orgQuestionParamSchema), staff, org.deleteQuestion);

/* --- question banks --- */

router.get('/organizations/:organizationId/question-banks', authenticate, validate(orgBankListSchema), staff, org.listQuestionBanks);
router.post('/organizations/:organizationId/question-banks', authenticate, validate(orgBankCreateSchema), staff, org.createQuestionBank);
router.patch('/organizations/:organizationId/question-banks/:bankId', authenticate, validate(orgBankUpdateSchema), staff, org.updateQuestionBank);
router.delete('/organizations/:organizationId/question-banks/:bankId', authenticate, validate(orgBankParamSchema), staff, org.deleteQuestionBank);
router.get('/organizations/:organizationId/question-banks/:bankId/questions', authenticate, validate(orgBankQuestionsSchema), staff, org.listQuestionBankQuestions);

/* --- students --- */

router.get('/organizations/:organizationId/students', authenticate, validate(orgStudentsListSchema), staff, org.listStudents);
router.get('/organizations/:organizationId/students/:studentId', authenticate, validate(orgStudentParamSchema), staff, org.getStudent);

/* --- community and reported questions --- */

router.get('/organizations/:organizationId/community/posts', authenticate, validate(orgPostListSchema), staff, org.listPosts);
router.post('/organizations/:organizationId/community/posts', authenticate, validate(orgPostCreateSchema), staff, org.createPost);
router.patch('/organizations/:organizationId/community/posts/:postId', authenticate, validate(orgPostUpdateSchema), staff, org.updatePost);
router.delete('/organizations/:organizationId/community/posts/:postId', authenticate, validate(orgPostParamSchema), staff, org.deletePost);
router.get('/organizations/:organizationId/question-flags', authenticate, validate(orgFlagListSchema), staff, org.listFlags);
router.patch('/organizations/:organizationId/question-flags/:flagId', authenticate, validate(orgFlagUpdateSchema), staff, org.updateFlag);

/* --- library --- */

router.get('/organizations/:organizationId/library/books', authenticate, validate(orgBookListSchema), staff, org.listBooks);
router.post('/organizations/:organizationId/library/books', authenticate, validate(orgBookCreateSchema), staff, org.createBook);
router.patch('/organizations/:organizationId/library/books/:bookId', authenticate, validate(orgBookUpdateSchema), staff, org.updateBook);
router.delete('/organizations/:organizationId/library/books/:bookId', authenticate, validate(orgBookParamSchema), staff, org.deleteBook);

/* --- money --- */

router.post('/organizations/:organizationId/payout/verify', authenticate, validate(orgPayoutVerifySchema), staff, org.verifyPayout);
router.put('/organizations/:organizationId/payout', authenticate, validate(orgPayoutSaveSchema), staff, org.savePayout);
router.get('/organizations/:organizationId/earnings', authenticate, validate(orgEarningsSchema), staff, org.getEarnings);
router.get('/organizations/:organizationId/payments', authenticate, validate(orgPaymentsListSchema), staff, org.listPayments);

/* --- domains --- */

router.get('/domains/check-subdomain', authenticate, validate(checkSubdomainSchema), org.checkSubdomain);
router.get('/organizations/:organizationId/domains', authenticate, validate(orgDomainListSchema), staff, org.listDomains);
router.post('/organizations/:organizationId/domains', authenticate, validate(orgDomainAddSchema), staff, org.addDomain);
router.post('/organizations/:organizationId/domains/:domainId/verify', authenticate, validate(orgDomainParamSchema), staff, org.verifyDomain);
router.delete('/organizations/:organizationId/domains/:domainId', authenticate, validate(orgDomainParamSchema), staff, org.removeDomain);

export default router;
