import { Router } from 'express';
import * as subject from '../controllers/subject.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  listSubjectsSchema,
  subjectCodeSchema,
  subjectIdSchema,
  createSubjectSchema,
  updateSubjectSchema,
} from '../validators/subject.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(listSubjectsSchema), subject.listSubjects);
router.get('/:code/topics', subject.getSubjectTopics);
router.post('/', authorize('admin'), validate(createSubjectSchema), subject.createSubject);

router.get('/:code', validate(subjectCodeSchema), subject.getSubject);
router.patch('/:id', authorize('admin'), validate(updateSubjectSchema), subject.updateSubject);
router.delete('/:id', authorize('admin'), validate(subjectIdSchema), subject.deleteSubject);

export default router;
