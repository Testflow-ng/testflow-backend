import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';
import * as admin from '../controllers/adminAds.controller.js';
import * as s from '../validators/ads.schema.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const singleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) return next(new AppError(422, 'INVALID_UPLOAD', err.message));
    if (!req.files || !req.files.length) {
      return next(new AppError(422, 'VALIDATION_ERROR', 'No image file uploaded.'));
    }
    req.file = req.files[0];
    next();
  });
};

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

// House Ads
router.get('/house-ads', admin.listHouseAds);
router.post('/house-ads', admin.createHouseAd);
router.post('/house-ads/image', singleUpload, admin.uploadHouseAdImage);
router.patch('/house-ads/:id', validate(s.idParam), admin.updateHouseAd);
router.delete('/house-ads/:id', validate(s.idParam), admin.deleteHouseAd);

export default router;
