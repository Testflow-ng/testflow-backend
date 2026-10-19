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

/** A revoked or unknown token. A 404 status with something a human can read. */
export const missingPageHtml = () =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Link not active | TestFlow</title>
    <meta name="robots" content="noindex" />
    <style>${LAYOUT}</style>
  </head>
  <body>
    <h1>This link is not active</h1>
    <p class="foot">The student may have stopped sharing it. Ask them for a fresh link.</p>
  </body>
</html>`;
