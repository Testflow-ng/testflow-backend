/**
 * The HTML share pages.
 *
 * Two audiences in one document. A crawler reads the `<head>` and never runs anything, so the
 * Open Graph tags have to be in the first response and cannot be produced by the app; a person
 * reads the `<body>`, which is why the page shows the same card the image shows plus a way into
 * the product.
 *
 * There is no script tag on purpose. Helmet's default CSP is `script-src 'self'`, which blocks an
 * inline redirect, and a share page that silently does nothing is worse than one that shows the
 * card. Inline CSS is allowed by the same policy, so the page is styled in place.
 */

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LAYOUT = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 24px; padding: 32px 20px;
    background: #f6f4ee; color: #1b4332;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  img.card { width: 100%; max-width: 640px; height: auto; border-radius: 20px;
    box-shadow: 0 18px 40px rgba(27, 67, 50, 0.14); }
  .cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px 28px; border-radius: 999px; background: #4a35f0; color: #fff;
    font-weight: 700; text-decoration: none; }
  .cta:focus-visible { outline: 3px solid #1b4332; outline-offset: 3px; }
  .foot { font-size: 13px; color: rgba(27, 67, 50, 0.66); text-align: center; }
  .foot a { color: inherit; }
`;

const head = ({ title, description, url, imageUrl, imageAlt, robots }) =>
  `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    ${robots ? `<meta name="robots" content="${escapeHtml(robots)}" />` : ''}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TestFlow" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`;

/**
 * A shared result.
 *
 * `noindex`: the link is unlisted and carries a name, so it is not something to put in a search
 * engine. Crawlers that build chat previews ignore this and read the tags anyway.
 */
export const resultPageHtml = ({ share, url, imageUrl, clientUrl }) => {
  const title = `${share.name} scored ${share.score}% in ${share.subjectCode}`;
  const description = `${share.correctCount} of ${share.totalQuestions} correct on TestFlow. Can you beat it?`;
  const imageAlt = `TestFlow score card: ${share.score}% in ${share.subjectCode}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${head({ title, description, url, imageUrl, imageAlt, robots: 'noindex' })}
    <style>${LAYOUT}</style>
  </head>
  <body>
    <img class="card" src="${escapeHtml(imageUrl)}" width="1200" height="630" alt="${escapeHtml(imageAlt)}" />
    <a class="cta" href="${escapeHtml(clientUrl)}">Take a practice test</a>
    <p class="foot">TestFlow, timed practice for OAU exams. <a href="${escapeHtml(clientUrl)}">testflow.com.ng</a></p>
  </body>
</html>`;
};

/**
 * A shared question.
 *
 * The recipient is meant to try it, so the card shows the question and its options and never the
 * answer. A human who opens the link is handed to the app's question page, which is where the
 * answer is revealed after they respond. The refresh is in the head rather than a script so that
 * it survives the app's own CSP.
 */
export const questionPageHtml = ({ question, url, imageUrl, clientUrl, appUrl }) => {
  const title = question.shareTitle || `Can you answer this ${question.subjectCode} question?`;
  const description = 'Answer it on TestFlow. The answer is revealed after you try.';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${head({
      title,
      description,
      url,
      imageUrl,
      imageAlt: `TestFlow question card: ${question.subjectCode}`,
    })}
    <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}" />
    <style>${LAYOUT}</style>
  </head>
  <body>
    <img class="card" src="${escapeHtml(imageUrl)}" width="1200" height="630" alt="${escapeHtml(
      `TestFlow question card: ${question.subjectCode}`,
    )}" />
    <a class="cta" href="${escapeHtml(appUrl)}">Answer this question</a>
    <p class="foot">TestFlow, timed practice for OAU exams. <a href="${escapeHtml(clientUrl)}">testflow.com.ng</a></p>
  </body>
</html>`;
};

/**
 * A tenant site's share page.
 *
 * The same rule as the other two: the tags a crawler reads are in the first response, and the
 * person is shown the school's card. There is no script, so the page does not redirect itself; the
 * CTA points at the tenant's own address for whoever taps it.
 */
export const sitePageHtml = ({ site, url, imageUrl }) => {
  const title = site.meta?.title ?? site.brand?.name ?? 'TestFlow for Everyone';
  const description = site.meta?.description ?? 'Online practice exams.';
  const imageAlt = `${title} share image`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${head({ title, description, url, imageUrl, imageAlt })}
    <meta name="theme-color" content="${escapeHtml(site.meta?.themeColor ?? '#163a5f')}" />
    <style>${LAYOUT}</style>
  </head>
  <body>
    <img class="card" src="${escapeHtml(imageUrl)}" width="1200" height="630" alt="${escapeHtml(imageAlt)}" />
    <a class="cta" href="${escapeHtml(url)}">Go to ${escapeHtml(title)}</a>
    <p class="foot">Powered by TestFlow.</p>
  </body>
</html>`;
};

const TV_STYLES = `
  .tf404 {
    --tv-body: #4a35f0;
    --tv-body-deep: #2f1fb5;
    --tv-light: #7d6df5;
    --tv-panel: #8f82f7;
    --tv-ink: #12281f;
    --tv-knob: #1b4332;
    --tv-knob-hi: #5f8f78;
    --tv-knob-lo: #10291f;
    --tv-lime: #d6e87c;
    --tv-lime-deep: #a9bd4a;
    --tv-lime-hi: #f1f8c4;
    position: relative;
    isolation: isolate;
    display: grid;
    place-items: center;
    font-size: clamp(10.5px, 3.4vw, 15px);
    width: 30em;
    max-width: 100%;
    height: 22em;
    margin-inline: auto;
    margin-bottom: 0.5em;
    overflow: visible;
  }
  .tf404 .main { display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 3em; }
  .tf404 .antenna { width: 5em; height: 5em; border-radius: 50%; border: 2px solid var(--tv-ink); background-color: var(--tv-lime); margin-bottom: -6em; z-index: -1; }
  .tf404 .antenna_shadow { position: absolute; background-color: transparent; width: 50px; height: 56px; margin-left: 1.68em; border-radius: 45%; transform: rotate(140deg); border: 4px solid transparent; box-shadow: inset 0px 16px var(--tv-lime-deep), inset 0px 16px 1px 1px var(--tv-lime-deep); }
  .tf404 .antenna::after { content: ''; position: absolute; margin-top: -9.4em; margin-left: 0.4em; transform: rotate(-25deg); width: 1em; height: 0.5em; border-radius: 50%; background-color: var(--tv-lime-hi); }
  .tf404 .antenna::before { content: ''; position: absolute; margin-top: 0.2em; margin-left: 1.25em; transform: rotate(-20deg); width: 1.5em; height: 0.8em; border-radius: 50%; background-color: var(--tv-lime-hi); }
  .tf404 .a1 { position: relative; top: -102%; left: -130%; width: 12em; height: 5.5em; border-radius: 50px; background-image: linear-gradient(#171717, #171717, #353535, #353535, #171717); transform: rotate(-29deg); clip-path: polygon(50% 0%, 49% 100%, 52% 100%); }
  .tf404 .a1d { position: relative; top: -211%; left: -35%; transform: rotate(45deg); width: 0.5em; height: 0.5em; border-radius: 50%; border: 2px solid var(--tv-ink); background-color: #979797; z-index: 99; }
  .tf404 .a2 { position: relative; top: -210%; left: -10%; width: 12em; height: 4em; border-radius: 50px; background-color: #171717; background-image: linear-gradient(#171717, #171717, #353535, #353535, #171717); margin-right: 5em; clip-path: polygon(47% 0, 47% 0, 34% 34%, 54% 25%, 32% 100%, 29% 96%, 49% 32%, 30% 38%); transform: rotate(-8deg); }
  .tf404 .a2d { position: relative; top: -294%; left: 94%; width: 0.5em; height: 0.5em; border-radius: 50%; border: 2px solid var(--tv-ink); background-color: #979797; z-index: 99; }
  .tf404 .notfound_text { background-color: #000; padding-inline: 0.3em; font-size: 0.75em; color: #fff; letter-spacing: 0; border-radius: 5px; z-index: 10; }
  .tf404 .tv { width: 17em; height: 9em; margin-top: 3em; border-radius: 15px; background-color: var(--tv-body); display: flex; justify-content: center; border: 2px solid var(--tv-ink); box-shadow: inset 0.2em 0.2em var(--tv-light); }
  .tf404 .tv::after { content: ''; position: absolute; width: 17em; height: 9em; border-radius: 15px; background: repeating-radial-gradient(var(--tv-body) 0 0.0001%, #00000070 0 0.0002%) 50% 0 / 2500px 2500px, repeating-conic-gradient(var(--tv-body) 0 0.0001%, #00000070 0 0.0002%) 60% 60% / 2500px 2500px; background-blend-mode: difference; opacity: 0.09; pointer-events: none; }
  .tf404 .curve_svg { position: absolute; margin-top: 0.25em; margin-left: -0.25em; height: 12px; width: 12px; fill: var(--tv-light); }
  .tf404 .display_div { display: flex; align-items: center; align-self: center; justify-content: center; border-radius: 15px; box-shadow: 3.5px 3.5px 0px var(--tv-light); }
  .tf404 .screen_out { border-radius: 10px; }
  .tf404 .screen_out1 { width: 11em; height: 7.75em; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
  .tf404 .screen { width: 13em; height: 7.85em; border: 2px solid var(--tv-ink); background: repeating-radial-gradient(#000 0 0.0001%, #ffffff 0 0.0002%) 50% 0 / 2500px 2500px, repeating-conic-gradient(#000 0 0.0001%, #ffffff 0 0.0002%) 60% 60% / 2500px 2500px; background-blend-mode: difference; animation: tf404-noise 0.2s infinite alternate; border-radius: 10px; z-index: 99; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #252525; letter-spacing: 0.15em; text-align: center; }
  .tf404 .screenM { width: 13em; height: 7.85em; position: relative; background: linear-gradient(to right, #002fc6 0%, #002bb2 14.2857%, #3a3a3a 14.2857%, #303030 28.5714%, #ff0afe 28.5714%, #f500f4 42.8571%, #6c6c6c 42.8571%, #626262 57.1429%, #0affd9 57.1429%, #00f5ce 71.4286%, #3a3a3a 71.4286%, #303030 85.7143%, white 85.7143%, #fafafa 100%); border-radius: 10px; border: 2px solid #000; z-index: 99; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #252525; letter-spacing: 0.15em; text-align: center; overflow: hidden; }
  .tf404 .screenM::before { content: ''; position: absolute; left: 0; top: 0; height: 68.478%; width: 100%; z-index: 1; background: linear-gradient(to right, white 0%, #fafafa 14.2857%, #ffe60a 14.2857%, #f5dc00 28.5714%, #0affd9 28.5714%, #00f5ce 42.8571%, #10ea00 42.8571%, #0ed600 57.1429%, #ff0afe 57.1429%, #f500f4 71.4286%, #ed0014 71.4286%, #d90012 85.7143%, #002fc6 85.7143%, #002bb2 100%); }
  .tf404 .screenM::after { content: ''; position: absolute; left: 0; bottom: 0; height: 21.739%; width: 100%; z-index: 1; background: linear-gradient(to right, #006c6b 0%, #005857 16.6667%, white 16.6667%, #fafafa 33.3333%, #001b75 33.3333%, #001761 50%, #6c6c6c 50%, #626262 66.6667%, #929292 66.6667%, #888888 83.3333%, #3a3a3a 83.3333%, #303030 100%); }
  .tf404 .screenM .notfound_text { position: relative; z-index: 5; }
  @keyframes tf404-noise { 100% { background-position: 50% 0, 60% 50%; } }
  .tf404 .lines { display: flex; column-gap: 0.1em; align-self: flex-end; }
  .tf404 .line1, .tf404 .line3 { width: 2px; height: 0.5em; background-color: var(--tv-ink); border-radius: 25px 25px 0 0; margin-top: 0.5em; }
  .tf404 .line2 { flex-grow: 1; width: 2px; height: 1em; background-color: var(--tv-ink); border-radius: 25px 25px 0 0; }
  .tf404 .buttons_div { width: 4.25em; align-self: center; height: 8em; background-color: var(--tv-panel); border: 2px solid var(--tv-ink); padding: 0.6em; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-direction: column; row-gap: 0.75em; box-shadow: 3px 3px 0px var(--tv-light); }
  .tf404 .b1, .tf404 .b2 { width: 1.65em; height: 1.65em; border-radius: 50%; background-color: var(--tv-knob); border: 2px solid #000; box-shadow: inset 2px 2px 1px var(--tv-knob-hi), -2px 0px var(--tv-knob-lo), -2px 0px 0px 1px #000; }
  .tf404 .b1::before { content: ''; position: absolute; margin-top: 1em; margin-left: 0.5em; transform: rotate(47deg); border-radius: 5px; width: 0.1em; height: 0.4em; background-color: #000; }
  .tf404 .b1::after { content: ''; position: absolute; margin-top: 0.9em; margin-left: 0.8em; transform: rotate(47deg); border-radius: 5px; width: 0.1em; height: 0.55em; background-color: #000; }
  .tf404 .b1 div { position: absolute; margin-top: -0.1em; margin-left: 0.65em; transform: rotate(45deg); width: 0.15em; height: 1.5em; background-color: #000; }
  .tf404 .b2::before { content: ''; position: absolute; margin-top: 1.05em; margin-left: 0.8em; transform: rotate(-45deg); border-radius: 5px; width: 0.15em; height: 0.4em; background-color: #000; }
  .tf404 .b2::after { content: ''; position: absolute; margin-top: -0.1em; margin-left: 0.65em; transform: rotate(-45deg); width: 0.15em; height: 1.5em; background-color: #000; }
  .tf404 .speakers { display: flex; flex-direction: column; row-gap: 0.5em; }
  .tf404 .speakers .g1 { display: flex; column-gap: 0.25em; }
  .tf404 .g11, .tf404 .g12, .tf404 .g13 { width: 0.65em; height: 0.65em; border-radius: 50%; background-color: var(--tv-knob); border: 2px solid #000; box-shadow: inset 1.25px 1.25px 1px var(--tv-knob-hi); }
  .tf404 .speakers .g { width: auto; height: 2px; background-color: #171717; }
  .tf404 .bottom { width: 100%; display: flex; align-items: center; justify-content: center; column-gap: 8.7em; }
  .tf404 .base1, .tf404 .base2 { height: 1em; width: 2em; border: 2px solid #171717; background-color: #4d4d4d; margin-top: -0.15em; z-index: -1; }
  .tf404 .base3 { position: absolute; height: 0.15em; width: 17.5em; background-color: #171717; margin-top: 0.8em; }
  .tf404 .text_404 { position: absolute; display: flex; flex-direction: row; column-gap: 6em; z-index: -5; margin-bottom: 2em; align-items: center; justify-content: center; color: #e9e5fb; font-weight: 800; }
  .tf404 .text_4041, .tf404 .text_4042, .tf404 .text_4043 { transform: scaleY(24.5) scaleX(9); }
  @media (max-width: 395px) {
    .tf404 .text_404 { column-gap: 4em; }
    .tf404 .text_4041, .tf404 .text_4042, .tf404 .text_4043 { transform: scaleY(25) scaleX(8); }
  }
  @media (max-width: 1024px) {
    .tf404 .screenM { display: flex; }
    .tf404 .screen { display: none; }
  }
  @media (min-width: 1025px) {
    .tf404 .screen { display: flex; }
    .tf404 .screenM { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tf404 .screen { animation: none; }
  }
  .tf-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.2em; color: rgba(27, 67, 50, 0.66); margin: 0;
  }
  .tf-title {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 26px; font-weight: 700; letter-spacing: -0.02em;
    color: #1b4332; margin: 4px 0 0 0; text-align: center;
  }
  .tf-desc {
    font-size: 14px; line-height: 1.6; color: rgba(27, 67, 50, 0.66);
    max-width: 380px; text-align: center; margin: 0;
  }
`;

/** A revoked or unknown token, or a missing question/page. Our custom 404 television page. */
export const missingPageHtml = ({
  title = 'Page not found',
  message = 'The page you are looking for does not exist or has been moved.',
  clientUrl = 'https://www.testflow.com.ng',
} = {}) =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | TestFlow</title>
    <meta name="robots" content="noindex" />
    <style>${LAYOUT}${TV_STYLES}</style>
  </head>
  <body>
    <div class="tf404" aria-hidden="true">
      <div class="main">
        <div class="antenna">
          <div class="antenna_shadow"></div>
          <div class="a1"></div>
          <div class="a1d"></div>
          <div class="a2"></div>
          <div class="a2d"></div>
          <div class="a_base"></div>
        </div>
        <div class="tv">
          <div class="cruve">
            <svg class="curve_svg" viewBox="0 0 189.929 189.929" xmlns="http://www.w3.org/2000/svg">
              <path d="M70.343,70.343c-30.554,30.553-44.806,72.7-39.102,115.635l-29.738,3.951C-5.442,137.659,11.917,86.34,49.129,49.13C86.34,11.918,137.664-5.445,189.928,1.502l-3.95,29.738C143.041,25.54,100.895,39.789,70.343,70.343z"></path>
            </svg>
          </div>
          <div class="display_div">
            <div class="screen_out">
              <div class="screen_out1">
                <div class="screen">
                  <span class="notfound_text">NOT FOUND</span>
                </div>
                <div class="screenM">
                  <span class="notfound_text">NOT FOUND</span>
                </div>
              </div>
            </div>
          </div>
          <div class="lines">
            <div class="line1"></div>
            <div class="line2"></div>
            <div class="line3"></div>
          </div>
          <div class="buttons_div">
            <div class="b1">
              <div></div>
            </div>
            <div class="b2"></div>
            <div class="speakers">
              <div class="g1">
                <div class="g11"></div>
                <div class="g12"></div>
                <div class="g13"></div>
              </div>
              <div class="g"></div>
              <div class="g"></div>
            </div>
          </div>
        </div>
        <div class="bottom">
          <div class="base1"></div>
          <div class="base2"></div>
          <div class="base3"></div>
        </div>
      </div>
      <div class="text_404">
        <div class="text_4041">4</div>
        <div class="text_4042">0</div>
        <div class="text_4043">4</div>
      </div>
    </div>
    <p class="tf-code">404</p>
    <h1 class="tf-title">${escapeHtml(title)}</h1>
    <p class="tf-desc">${escapeHtml(message)}</p>
    <a class="cta" href="${escapeHtml(clientUrl)}">Back to home</a>
  </body>
</html>`;
