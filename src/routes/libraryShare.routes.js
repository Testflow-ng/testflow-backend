import { Router } from 'express';
import * as share from '../controllers/libraryShare.controller.js';
import { sharedRateLimit } from '../middleware/rateLimit.js';

/**
 * The public library links live at the root, not under `/api`.
 *
 * They are pages a person opens and a crawler fetches, not API resources, and they are public by
 * design: the token is the credential, so there is no session check and no CSRF token to carry.
 * The file handlers are limited per token and IP so a leaked link cannot be hammered into a
 * bandwidth bill.
 */
const router = Router();

const shareLimiter = sharedRateLimit({
  name: 'library-share',
  windowMs: 60 * 60 * 1000,
  max: 240,
  key: (req) => `${req.ip}:${req.params?.token ?? ''}`,
});

router.get('/book/:token', shareLimiter, share.bookPage);
router.get('/book/:token/card.png', shareLimiter, share.bookCard);
router.get('/book/:token/file', shareLimiter, share.bookFile);
router.get('/note/:token', shareLimiter, share.notePage);
router.get('/note/:token/og.png', shareLimiter, share.noteOg);
router.get('/note/:token/image/:index', shareLimiter, share.noteImage);

export default router;
