import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import * as ctrl from '../controllers/notification.controller.js';

const router = Router();

// Device token registration & unregistration (authenticated users)
router.post('/register-token', authenticate, ctrl.registerToken);
router.post('/unregister-token', authenticate, ctrl.unregisterToken);

// User notification preferences
router.get('/preferences', authenticate, ctrl.getPreferences);
router.put('/preferences', authenticate, ctrl.updatePreferences);

// Test notification
router.post('/test', authenticate, ctrl.sendTestPush);

// Admin announcement broadcasting
router.post('/broadcast', authenticate, authorize('admin', 'super_admin'), ctrl.broadcast);
router.get('/announcements', authenticate, authorize('admin', 'super_admin'), ctrl.listAnnouncements);

export default router;
