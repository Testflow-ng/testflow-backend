import { Router } from 'express';
import * as publicController from '../controllers/public.controller.js';

const router = Router();

router.get('/stats', publicController.getPublicStats);
router.get('/config', publicController.getConfig);

// Shareable Questions
router.get('/questions/:id', publicController.getPublicQuestion);
router.post('/questions/:id/respond', publicController.submitPublicResponse);
router.get('/questions/:id/share', publicController.generateSharePage);

export default router;
