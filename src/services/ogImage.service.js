import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MARK_BOX, questionCardSvg, resultCardSvg, siteCardSvg } from '../utils/cardSvg.js';

/**
 * Rasterise the share cards.
 *
 * `sharp` renders the SVG (it is already a dependency for uploads) and stamps the TestFlow mark
 * on top, because the brand mark is a raster asset and the rest of the card is vector. No new
 * dependency, no headless browser, and nothing to keep in sync at deploy time beyond the mark.
 *
 * The mark is a copy of `frontend/public/brand/logo.webp`: the two projects deploy separately, so
 * the backend carries its own copy rather than reaching across the filesystem at request time.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MARK_FILE = path.join(here, '..', 'assets', 'testflow-mark.webp');

let markPromise;

/**
 * The mark, trimmed of its transparent margin and scaled to the box the card reserved for it.
 * Opaque trims would crop the monogram itself, so the file has to keep real alpha.
 */
const loadMark = () => {
  markPromise ??= sharp(MARK_FILE)
    .trim()
    .resize(MARK_BOX.size, MARK_BOX.size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return markPromise;
};

const renderCard = async (svg) => {
  const mark = await loadMark();
  return sharp(Buffer.from(svg))
    .composite([{ input: mark, left: MARK_BOX.left, top: MARK_BOX.top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

/** The score card for a shared attempt. */
export const resultCardPng = (share) => renderCard(resultCardSvg(share));

/** The card for a public question, which never shows the answer. */
export const questionCardPng = (question) => renderCard(questionCardSvg(question));

/**
 * The share card for a tenant site.
 *
 * Rendered without the TestFlow mark on purpose: the card already carries "Powered by TestFlow",
 * and stamping the logo would put our brand where the school's should be. It is still rasterised
 * here so every share image comes off one code path.
 */
export const siteCardPng = (site) => sharp(Buffer.from(siteCardSvg(site))).png({ compressionLevel: 9 }).toBuffer();
