import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';
import { requestOrigin } from '../utils/requestOrigin.js';
import { bandForScore } from '../utils/scoreBand.js';
import { missingPageHtml, resultPageHtml } from '../utils/shareHtml.js';
import { findShare } from '../services/resultShare.service.js';
import { resultCardPng } from '../services/ogImage.service.js';

/**
 * The public result link.
 *
 * No session, no cookies: the token is the whole credential, and anybody the student sends it to
 * gets the same page. The page is built per request rather than cached, because the Open Graph
 * URLs have to be absolute and the host is the one the caller used.
 */
export const resultPage = asyncHandler(async (req, res) => {
  const share = await findShare(req.params.token);

  // A revoked link is a dead link. An HTML 404 rather than a JSON envelope: a person tapping a
  // stale link should read a sentence, not an API error.
  if (!share) {
    return res.status(404).type('html').send(missingPageHtml());
  }

  const url = `${requestOrigin(req)}/r/${share.token}`;
  return res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      resultPageHtml({
        share,
        url,
        imageUrl: `${url}/og.png`,
        clientUrl: config.CLIENT_URL,
      }),
    );
});

/**
 * The card the chat preview shows.
 *
 * Immutable because a token always means the same attempt: the score behind it never changes. The
 * resource policy is relaxed because a crawler fetches this image outside any document context,
 * where the same-origin default would refuse it.
 */
export const resultCard = asyncHandler(async (req, res) => {
  const share = await findShare(req.params.token);
  if (!share) {
    throw new AppError(404, 'SHARE_NOT_FOUND', 'That link is not active.');
  }

  const band = bandForScore(share.score);
  const png = await resultCardPng({ ...share, band: band.label, mood: band.mood });

  res
    .type('png')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .set('Cross-Origin-Resource-Policy', 'cross-origin')
    .send(png);
});
