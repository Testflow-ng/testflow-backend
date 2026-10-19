import { Router } from 'express';
import authRoutes from './auth.routes.js';
import subjectRoutes from './subject.routes.js';
import questionRoutes from './question.routes.js';
import questionFlagRoutes from './questionFlag.routes.js';
import questionBookmarkRoutes from './questionBookmark.routes.js';
import examSessionRoutes from './examSession.routes.js';
import feedbackRoutes from './feedback.routes.js';
import postUtmeRoutes from './postUtme.routes.js';
import liveCbtRoutes from './liveCbt.routes.js';
import verificationRoutes from './verification.routes.js';
import adminRoutes from './admin.routes.js';
import publicRoutes from './public.routes.js';
import adsRoutes from './ads.routes.js';
import adminAdsRoutes from './adminAds.routes.js';
import everybodyRoutes from './everybody.routes.js';
import everybodySubscriptionRoutes from './everybody.subscription.routes.js';
import siteRoutes from './site.routes.js';
import adminOrgRoutes from './adminOrg.routes.js';

const router = Router();

router.use('/public', publicRoutes);
router.use('/auth', authRoutes);
router.use('/subjects', subjectRoutes);
// Reporting or saving a question is a student action, and the bank guards its whole prefix with
// an admin check, so the student routes have to be reached first. Each is mounted at its own
// prefix rather than at the root, so its session check cannot leak onto another feature's routes.
router.use('/questions', questionFlagRoutes);
router.use('/questions', questionRoutes);
router.use('/question-bookmarks', questionBookmarkRoutes);
router.use('/exam-sessions', examSessionRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/post-utme', postUtmeRoutes);
router.use('/live-cbt', liveCbtRoutes);
router.use('/verifications', verificationRoutes);
router.use('/ads', adsRoutes);
router.use('/admin/ads', adminAdsRoutes); // before '/admin' so it is matched first
router.use('/admin', adminRoutes);
router.use('/v1/everybody', everybodyRoutes);
// Same prefix: the subscription routes carry their own `/organizations/:organizationId/...` and
// `/subscriptions/webhook` paths, so they sit beside `everybodyRoutes` rather than under it.
router.use('/v1/everybody', everybodySubscriptionRoutes);
router.use('/v1/everybody/site', siteRoutes);
router.use('/v1/admin/everybody', adminOrgRoutes);

export default router;
