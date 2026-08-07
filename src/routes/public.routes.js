import { Router } from 'express';
import * as publicController from '../controllers/public.controller.js';

const router = Router();

router.get('/stats', publicController.getPublicStats);
router.get('/config', publicController.getConfig);

export default router;
