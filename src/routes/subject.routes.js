import { Router } from 'express';
import * as subject from '../controllers/subject.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  listSubjectsSchema,
  subjectCodeSchema,
  updateSubjectSchema,
} from '../validators/subject.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(listSubjectsSchema), subject.listSubjects);
router.get('/:code', validate(subjectCodeSchema), subject.getSubject);
router.patch('/:code', authorize('admin'), validate(updateSubjectSchema), subject.updateSubject);

export default router;
