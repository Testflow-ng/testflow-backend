/**
 * Flo, the TestFlow mascot, as an SVG fragment for the share cards.
 *
 * This is a port of `frontend/src/components/brand/Mascot.jsx`, which is the source of truth for
 * the character. Flo is drawn there on a 72x76 grid out of data tables (arms, brows, eyes,
 * mouths), so the same tables carry over; only the four moods a score card can wear are kept.
 * The colours are the `--flo-*` tokens from `mascotMotion.css`, inlined because an SVG handed to
 * a rasteriser has no cascade to inherit them from.
 *
 * If the client's mascot is redrawn, this file is the thing that has to follow.
 */

const INK = '#1b4332';
const ACCENT = '#4a35f0';
const HI = '#d6e87c';
const BODY = '#e9e5fb';

const ARMS = {
  restL: { d: 'M14 38C10 39 8 43 8.5 46.5', hand: [8, 49] },
  restR: { d: 'M58 38C62 39 64 43 63.5 46.5', hand: [64, 49] },
  upL: { d: 'M14 34C10 30 7 22 6.5 16', hand: [6, 12.5] },
  upR: { d: 'M58 34C62 30 65 22 65.5 16', hand: [66, 12.5] },
  waveR: { d: 'M58 35C62.5 32 66 26 67 21', hand: [67.5, 17.5] },
};

/** The stub that turns a raised fist into a thumbs-up. */
const THUMB = 'M66 10.5V5.5';

const BROWS = {
  sad: ['M23.5 26.5 L31 28.6', 'M48.5 26.5 L41 28.6'],
  excited: ['M23.8 26 Q28 23.4 32 26', 'M40 26 Q44 23.4 48.2 26'],
  encouraging: ['M23.8 27 Q28 25.6 32 27', 'M40 27 Q44 25.6 48.2 27'],
};

const MOODS = {
  excited: { mouth: 'open', eyes: 'wide', arms: ['upL', 'upR'] },
  thumbsUp: { mouth: 'M30.5 40.5 Q36 46 41.5 40.5', eyes: 'squint', arms: ['restL', 'upR'], thumb: true },
  encouraging: { mouth: 'M30.5 40.5 Q36 45.8 41.5 40.5', eyes: 'open', arms: ['restL', 'waveR'] },
  sad: { mouth: 'M30.5 44 Q36 38.6 41.5 44', eyes: 'down', arms: ['restL', 'restR'], tear: true },
};

const EYE_CENTRES = [28, 44];

const EYE_GEOMETRY = {
  open: { rx: 3.8, ry: 4.4, cy: 33, hi: 1.3 },
  wide: { rx: 4.5, ry: 5.2, cy: 32.6, hi: 1.6 },
  down: { rx: 3.5, ry: 3.8, cy: 34.2, hi: 1.1 },
};

const armMarkup = (pose, thumb) => {
  const [hx, hy] = pose.hand;
  return `<path d="${pose.d}" stroke="${INK}" stroke-width="3"/>${
    thumb ? `<path d="${THUMB}" stroke="${INK}" stroke-width="5.2"/><path d="${THUMB}" stroke="${HI}" stroke-width="2.2"/>` : ''
  }<circle cx="${hx}" cy="${hy}" r="3.9" fill="${HI}" stroke="${INK}" stroke-width="1.8"/>`;
};

const eyesMarkup = (variant) => {
  if (variant === 'squint') {
    return `<g stroke="${INK}" stroke-width="2.6">${EYE_CENTRES.map(
      (cx) => `<path d="M${cx - 3.6} 34.4 Q${cx} 30 ${cx + 3.6} 34.4"/>`,
    ).join('')}</g>`;
  }

  const geometry = EYE_GEOMETRY[variant] ?? EYE_GEOMETRY.open;
  const pupils = EYE_CENTRES.map(
    (cx) => `<ellipse cx="${cx}" cy="${geometry.cy}" rx="${geometry.rx}" ry="${geometry.ry}" fill="${INK}"/>`,
  ).join('');
  // Two catchlights per eye: the big one gives life, the small one gives depth.
  const highlights = EYE_CENTRES.map(
    (cx) =>
      `<circle cx="${cx + 1.4}" cy="${geometry.cy - 1.8}" r="${geometry.hi}" fill="#fff"/>` +
      `<circle cx="${cx - 1.4}" cy="${geometry.cy + 1.7}" r="${(geometry.hi * 0.5).toFixed(2)}" fill="#fff"/>`,
  ).join('');

  return `<g stroke-width="0">${pupils}<g>${highlights}</g></g>`;
};

const mouthMarkup = (shape) => {
  if (shape === 'open') {
    return (
      `<path d="M30 40 Q36 40 42 40 Q42 47.5 36 47.5 Q30 47.5 30 40Z" fill="${INK}" stroke="${INK}" stroke-width="2.2"/>` +
      `<path d="M32.6 45.6 Q36 43.2 39.4 45.6 Q38 47.4 36 47.4 Q34 47.4 32.6 45.6Z" fill="${ACCENT}" stroke="none"/>`
    );
  }
  return `<path d="${shape}" stroke="${INK}" stroke-width="2.6"/>`;
};

const browsMarkup = (mood) => {
  const set = BROWS[mood];
  if (!set) return '';
  return `<g stroke="${INK}" stroke-width="2.2" opacity="0.9">${set.join('')}</g>`;
};

/**
 * Flo as a `<g>`, scaled from the 72x76 grid to `size` and placed at `x, y`.
 * `mood` is one of `excited`, `thumbsUp`, `encouraging`, `sad`, each of which is a mood the
 * client's mascot knows.
 */
export const floSvg = ({ mood = 'sad', x = 0, y = 0, size = 220 } = {}) => {
  const spec = MOODS[mood] ?? MOODS.sad;
  const [armL, armR] = spec.arms;

  return `<g transform="translate(${x} ${y}) scale(${(size / 72).toFixed(4)})" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<ellipse cx="36" cy="66" rx="19" ry="2.8" fill="${INK}" opacity="0.12" stroke="none"/>` +
    `<g stroke="none">` +
    `<rect x="19.5" y="58.6" width="14" height="7.4" rx="3.7" fill="${INK}"/>` +
    `<rect x="38.5" y="58.6" width="14" height="7.4" rx="3.7" fill="${INK}"/>` +
    `</g>` +
    `<g>${armMarkup(ARMS[armL])}${armMarkup(ARMS[armR], spec.thumb)}</g>` +
    // The sheet: the body path's closing segment is the fold diagonal.
    `<path d="M27 6H49C54.5 6 58 9.5 58 15V51C58 56.5 54.5 60 49 60H23C17.5 60 14 56.5 14 51V19Z" fill="${BODY}" stroke="${INK}" stroke-width="2.6"/>` +
    `<path d="M27 6V13C27 16.5 24.5 19 21 19H14Z" fill="${ACCENT}" stroke="${INK}" stroke-width="2.2"/>` +
    `<path d="M31 19.6H51" stroke="${HI}" stroke-width="3.6"/>` +
    `<g fill="${ACCENT}" opacity="0.16" stroke="none">` +
    `<ellipse cx="22" cy="40" rx="3.6" ry="2.4"/>` +
    `<ellipse cx="50" cy="40" rx="3.6" ry="2.4"/>` +
    `</g>` +
    browsMarkup(mood) +
    eyesMarkup(spec.eyes) +
    mouthMarkup(spec.mouth) +
    (spec.tear
      ? `<path d="M31 38.5C31 38.5 29.4 41.4 29.4 42.6C29.4 43.6 30.1 44.3 31 44.3C31.9 44.3 32.6 43.6 32.6 42.6C32.6 41.4 31 38.5 31 38.5Z" fill="#7aa7ff" stroke="none"/>`
      : '') +
    // Answered boxes down the margin: ink boxes with indigo ticks.
    `<g stroke-width="1.8">` +
    [45.5, 52.5]
      .map(
        (ty) =>
          `<rect x="19.5" y="${ty}" width="5" height="5" rx="1.4" stroke="${INK}" fill="#fff"/>` +
          `<path d="M20.6 ${ty + 2.5}L22 ${ty + 3.9}L25 ${ty + 0.6}" stroke="${ACCENT}" stroke-width="1.9"/>`,
      )
      .join('') +
    `</g>` +
    `</g>`;
};
