import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import * as verification from '../controllers/verification.controller.js';

const router = Router();

router.use(authenticate);

// Student routes
router.get('/auth', verification.getIKAuth);
router.post('/submit', verification.submitRequest);
router.get('/my-status', verification.getMyRequest);

// Admin routes
router.get('/queue', authorize('admin'), verification.getQueue);
router.patch('/:id/process', authorize('admin'), verification.processRequest);

export default router;
