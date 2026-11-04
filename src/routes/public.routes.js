import { Router } from 'express';
import * as publicController from '../controllers/public.controller.js';

const router = Router();

router.get('/stats', publicController.getPublicStats);
router.get('/config', publicController.getConfig);
router.get('/live-cbt/:code', publicController.getLiveCbtLanding);

// Shareable Questions
router.get('/questions/:id', publicController.getPublicQuestion);
router.post('/questions/:id/respond', publicController.submitPublicResponse);
// The image the chat preview shows, rendered with the question and without its answer.
router.get('/questions/:id/og.png', publicController.getPublicQuestionCard);
router.get('/questions/:id/share', publicController.generateSharePage);

export default router;
