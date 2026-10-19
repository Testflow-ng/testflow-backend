import { Router } from 'express';
import authRoutes from './auth.routes.js';
import subjectRoutes from './subject.routes.js';
import questionRoutes from './question.routes.js';
import questionFlagRoutes from './questionFlag.routes.js';
import questionBookmarkRoutes from './questionBookmark.routes.js';
import libraryRoutes from './library.routes.js';
import leaderboardRoutes from './leaderboard.routes.js';
import examSessionRoutes from './examSession.routes.js';
import feedbackRoutes from './feedback.routes.js';
import postUtmeRoutes from './postUtme.routes.js';
import liveCbtRoutes from './liveCbt.routes.js';
import verificationRoutes from './verification.routes.js';
import adminRoutes from './admin.routes.js';
import publicRoutes from './public.routes.js';
import tenantRoutes from './tenant.routes.js';
import adsRoutes from './ads.routes.js';
import adminAdsRoutes from './adminAds.routes.js';
import everybodyRoutes from './everybody.routes.js';
import everybodySubscriptionRoutes from './everybody.subscription.routes.js';
import siteRoutes from './site.routes.js';
import orgConsoleRoutes from './orgConsole.routes.js';
import adminOrgRoutes from './adminOrg.routes.js';
import advertisingRoutes from './advertising.routes.js';
import billingRoutes from './billing.routes.js';

const router = Router();

router.use('/public', publicRoutes);
// The tenant site API, i.e. the calls the frontend makes on an organisation's own address.
router.use('/v1/public', tenantRoutes);
router.use('/auth', authRoutes);
router.use('/subjects', subjectRoutes);
// The Hall of Fame overall board, across every subject.
router.use('/leaderboard', leaderboardRoutes);
// Reporting or saving a question is a student action, and the bank guards its whole prefix with
// an admin check, so the student routes have to be reached first. Each is mounted at its own
// prefix rather than at the root, so its session check cannot leak onto another feature's routes.
router.use('/questions', questionFlagRoutes);
router.use('/questions', questionRoutes);
router.use('/question-bookmarks', questionBookmarkRoutes);
// The shelf, the reader and the download. Reading and downloading are part of the Student Pass;
// browsing, bookmarking and progress are not.
router.use('/library', libraryRoutes);
router.use('/exam-sessions', examSessionRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/post-utme', postUtmeRoutes);
router.use('/live-cbt', liveCbtRoutes);
router.use('/verifications', verificationRoutes);
router.use('/ads', adsRoutes);
// Provider-aware advertising (Google AdSense) and the student pass that removes ads. Both are
// separate from `/ads`, which is the Testflow Ads marketplace.
router.use('/advertising', advertisingRoutes);
router.use('/billing', billingRoutes);
router.use('/admin/ads', adminAdsRoutes); // before '/admin' so it is matched first
router.use('/admin', adminRoutes);
router.use('/v1/everybody', everybodyRoutes);
// Same prefix: the subscription routes carry their own `/organizations/:organizationId/...` and
// `/subscriptions/webhook` paths, so they sit beside `everybodyRoutes` rather than under it.
router.use('/v1/everybody', everybodySubscriptionRoutes);
// The site builder, the console (exams, questions, students, library, money, domains) and the flat
// aliases (`/banks`, `/plans`, `/subscription`, `/payments`) all answer under the same prefix.
router.use('/v1/everybody', siteRoutes);
router.use('/v1/everybody', orgConsoleRoutes);
router.use('/v1/admin/everybody', adminOrgRoutes);

export default router;
