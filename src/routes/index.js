import { Router } from 'express';
import authRoutes from './auth.routes.js';
import subjectRoutes from './subject.routes.js';
import questionRoutes from './question.routes.js';
import examSessionRoutes from './examSession.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/subjects', subjectRoutes);
router.use('/questions', questionRoutes);
router.use('/exam-sessions', examSessionRoutes);

export default router;
