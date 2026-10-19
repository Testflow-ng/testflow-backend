import { floSvg } from './floSvg.js';

/**
 * The two share cards, authored as SVG and rasterised by `services/ogImage.service.js`.
 *
 * They are built here rather than in the client because a crawler does not run JavaScript: the
 * image WhatsApp shows comes off the server or does not exist. SVG keeps the logo and Flo as
 * vectors right up to the final encode, and `sharp` is already a dependency, so this needs no
 * new one and no headless browser.
 *
 * Text is placed with absolute coordinates and wrapped by hand, because an SVG handed to a
 * rasteriser has no layout engine. The wrap estimates glyph width from the font size, which is
 * close enough for Helvetica-class type at these sizes and wrong by less than a word.
 */

const CREAM = '#f6f4ee';
const LAVENDER = '#e9e5fb';
const INK = '#1b4332';
const INDIGO = '#4a35f0';
const LIME = '#d6e87c';
const MUTED = 'rgba(27, 67, 50, 0.66)';

const WIDTH = 1200;
const HEIGHT = 630;

/** Average glyph width as a fraction of the font size, for wrapping and for pill widths. */
const WIDTH_FACTOR = 0.55;

/** Where `sharp` stamps the brand mark. The SVG leaves this gap empty. */
export const MARK_BOX = { left: 72, top: 56, size: 88 };

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Inline math is readable once the delimiters are gone: `$v = u + at$` is the same sentence as
 * `v = u + at`. Commands collapse to a space rather than to nothing, so `\frac{a}{b}` does not
 * come back as `fracab`.
 */
export const plainText = (value) =>
  String(value ?? '')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/\$+/g, '')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const estimateWidth = (text, fontSize) => String(text).length * fontSize * WIDTH_FACTOR;

/**
 * Wrap to at most `maxLines`, ellipsising the last line when the words do not fit. The caller
 * sizes the box; this only decides where the line breaks land.
 */
export const wrapText = (text, { maxWidth, fontSize, maxLines = 3 }) => {
  const perLine = Math.max(8, Math.floor(maxWidth / (fontSize * WIDTH_FACTOR)));
  const words = plainText(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  const shown = lines.join(' ');
  const hidden = shown.length < words.join(' ').length;
  if (hidden && lines.length) {
    const last = lines[lines.length - 1].replace(/[.,;:]$/, '');
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
};

const text = ({ x, y, size, weight = 400, fill = INK, content, anchor = 'start', opacity }) =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"${
    anchor === 'middle' ? ' text-anchor="middle"' : ''
  }${opacity ? ` opacity="${opacity}"` : ''}>${escapeXml(content)}</text>`;

const wordmark = ({ x, y, size }) => text({ x, y, size, weight: 700, content: 'TestFlow' });

/** A rounded label sized to its own text, which SVG will not do for us. */
const pill = ({ x, y, height, label, fontSize, fill, color }) => {
  const width = Math.round(44 + estimateWidth(label, fontSize));
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>` +
    text({
      x: x + width / 2,
      y: y + height / 2 + fontSize * 0.35,
      size: fontSize,
      weight: 700,
      fill: color,
      content: label,
      anchor: 'middle',
    })
  );
};

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
  `<rect width="${WIDTH}" height="${HEIGHT}" fill="${CREAM}"/>` +
  body +
  `</svg>`;

/**
 * A finished attempt: the score, the subject and count, the band, and Flo in the mood the score
 * earned. The student's name is deliberately absent from the image; it rides in the og:title of
 * the page instead, which is where the spec puts it.
 */
export const resultCardSvg = ({ subjectCode, score, correctCount, totalQuestions, band, mood }) => {
  const panel = { x: 696, y: 56, width: 448, height: 518, radius: 44 };
  const floSize = 300;

  return svg(
    `<rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" rx="${panel.radius}" fill="${LAVENDER}"/>` +
      floSvg({
        mood,
        size: floSize,
        x: panel.x + panel.width / 2 - floSize / 2,
        y: panel.y + panel.height / 2 - (floSize * 76) / 72 / 2,
      }) +
      wordmark({ x: MARK_BOX.left + MARK_BOX.size + 18, y: MARK_BOX.top + MARK_BOX.size / 2 + 14, size: 40 }) +
      text({ x: 72, y: 392, size: 200, weight: 800, content: `${score}%` }) +
      text({
        x: 76,
        y: 452,
        size: 40,
        fill: MUTED,
        content: `${subjectCode}  ·  ${correctCount} / ${totalQuestions} correct`,
      }) +
      pill({ x: 72, y: 496, height: 64, label: band, fontSize: 34, fill: LIME, color: INK }),
  );
};

/**
 * A public question, without its answer: the whole point of the link is that the recipient tries
 * it, so nothing here may give the key away.
 */
export const questionCardSvg = ({ subjectCode, stem, options }) => {
  const stemLines = wrapText(stem, { maxWidth: 820, fontSize: 42, maxLines: 3 });
  const shown = (options ?? []).slice(0, 4);
  const extra = (options ?? []).length - shown.length;

  const stemMarkup = stemLines
    .map((line, index) => text({ x: 72, y: 220 + index * 58, size: 42, weight: 600, content: line }))
    .join('');

  const optionMarkup = shown
    .map((option, index) => {
      const y = 380 + index * 48;
      const label = String.fromCharCode(65 + index);
      const line = wrapText(option, { maxWidth: 700, fontSize: 30, maxLines: 1 })[0] ?? '';
      return (
        `<rect x="72" y="${y - 24}" width="36" height="36" rx="10" fill="${LAVENDER}"/>` +
        text({ x: 90, y: y + 2, size: 24, weight: 700, fill: INDIGO, content: label, anchor: 'middle' }) +
        text({ x: 126, y, size: 30, fill: MUTED, content: line })
      );
    })
    .join('');

  const extraMarkup = extra > 0
    ? text({ x: 126, y: 380 + shown.length * 48, size: 26, fill: MUTED, content: `+${extra} more option${extra === 1 ? '' : 's'} on the page` })
    : '';

  return svg(
    `<rect x="944" y="56" width="184" height="518" rx="44" fill="${LAVENDER}"/>` +
      floSvg({ mood: 'encouraging', size: 170, x: 951, y: 250 }) +
      wordmark({ x: MARK_BOX.left + MARK_BOX.size + 14, y: MARK_BOX.top + MARK_BOX.size / 2 + 11, size: 32 }) +
      pill({ x: 944, y: 530, height: 44, label: subjectCode ?? 'TestFlow', fontSize: 24, fill: INDIGO, color: '#ffffff' }) +
      stemMarkup +
      optionMarkup +
      extraMarkup,
  );
};
