import { Router } from 'express';
import * as postUtme from '../controllers/postUtme.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.use(authenticate);

router.post('/start', postUtme.startSession);
router.patch('/:id/answer', postUtme.saveAnswer);
router.post('/:id/submit', postUtme.submitSession);
router.post('/:id/strike', postUtme.recordStrike);
router.get('/stats', postUtme.getStats);

export default router;
