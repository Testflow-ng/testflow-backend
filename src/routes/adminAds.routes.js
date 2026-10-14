import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import * as admin from '../controllers/adminAds.controller.js';
import * as s from '../validators/ads.schema.js';

const router = Router();
router.use(authenticate, authorize('admin')); // admin + super_admin

router.get('/overview', admin.overview);
router.get('/campaigns', validate(s.adminListSchema), admin.list);
router.get('/campaigns/:id', validate(s.idParam), admin.inspect);
router.get('/campaigns/:id/history', validate(s.idParam), admin.history);
router.get('/campaigns/:id/analytics', validate(s.analyticsSchema), admin.campaignAnalytics);
router.post('/campaigns/:id/approve', validate(s.idParam), admin.approve);
router.post('/campaigns/:id/reject', validate(s.rejectSchema), admin.reject);
router.post('/campaigns/:id/suspend', validate(s.reasonSchema), admin.suspend);
router.post('/campaigns/:id/reinstate', validate(s.idParam), admin.reinstate);
router.post('/campaigns/:id/remove', validate(s.reasonSchema), admin.remove);
router.get('/payments', validate(s.adminPaymentsSchema), admin.listPayments);
router.post('/payments/:id/refund', validate(s.reasonSchema), admin.refund);
router.get('/settings', admin.getSettings);
router.patch('/settings', validate(s.settingsSchema), admin.updateSettings);
router.get('/jobs', admin.jobRuns);
router.get('/training/summary', admin.trainingSummary);
router.get('/training/export', authorize('super_admin'), validate(s.trainingExportSchema), admin.trainingExport);

export default router;
