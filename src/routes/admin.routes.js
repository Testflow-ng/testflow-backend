import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

// All routes here are admin-only
router.use(authenticate, authorize('admin'));

router.get('/stats', admin.getDashboardStats);

export default router;
