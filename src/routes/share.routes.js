import { Router } from 'express';
import * as share from '../controllers/share.controller.js';

const router = Router();

/**
 * The public result link lives at the root, not under `/api`.
 *
 * It is a page a person opens and a crawler fetches, not an API resource, and it is public by
 * design: the token is the credential, so there is no session check and no CSRF token to carry.
 * Both handlers are mounted here so the two ways of reading one attempt stay adjacent.
 */
router.get('/:token', share.resultPage);
router.get('/:token/og.png', share.resultCard);

export default router;
