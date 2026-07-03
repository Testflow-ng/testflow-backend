import { Router } from 'express';
import * as question from '../controllers/question.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createQuestionSchema,
  updateQuestionSchema,
  questionIdSchema,
  listQuestionsSchema,
  bulkCreateQuestionsSchema,
} from '../validators/question.schema.js';

const router = Router();

// The entire question bank is admin-only.
router.use(authenticate, authorize('admin'));

router.get('/', validate(listQuestionsSchema), question.listQuestions);
router.post('/', validate(createQuestionSchema), question.createQuestion);
router.post('/bulk', validate(bulkCreateQuestionsSchema), question.bulkCreateQuestions);
router.get('/:id', validate(questionIdSchema), question.getQuestion);
router.patch('/:id', validate(updateQuestionSchema), question.updateQuestion);
router.delete('/:id', validate(questionIdSchema), question.deleteQuestion);

export default router;
