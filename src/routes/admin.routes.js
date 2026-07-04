import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

// All routes here are admin-only
router.use(authenticate, authorize('admin'));

router.get('/stats', admin.getDashboardStats);
router.get('/students', admin.listStudents);
router.patch('/students/:id/reset-password', admin.resetUserPassword);
router.patch('/students/:id/toggle-status', admin.toggleUserStatus);
router.get('/export-results', admin.exportResults);

// Admin Management (Super Admin only)
router.get('/roster', admin.listAdmins);
router.post('/create', admin.createAdmin);
router.post('/promote', admin.promoteToAdmin);

export default router;
