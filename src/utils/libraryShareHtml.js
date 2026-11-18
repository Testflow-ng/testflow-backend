/**
 * The public library share pages.
 *
 * Same contract as the result cards (`utils/shareHtml.js`): a crawler reads the `<head>` and never
 * runs anything, so the Open Graph tags are in the first response; a person reads the `<body>`.
 * There is no script tag on purpose — an inline redirect would be blocked by Helmet's CSP, and a
 * page that silently does nothing is worse than one that shows the content instead.
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
    align-items: center; padding: 28px 16px 48px;
    background: #f6f4ee; color: #1b4332;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .wordmark { font-size: 15px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(27, 67, 50, 0.55); margin: 4px 0 18px; }
  .sheet { width: 100%; max-width: 860px; background: #fff; border-radius: 24px;
    border: 1px solid rgba(27, 67, 50, 0.09); box-shadow: 0 18px 40px rgba(27, 67, 50, 0.10);
    padding: 26px 24px; }
  .code { display: inline-block; padding: 6px 16px; border-radius: 999px; background: #1b4332;
    color: #f6f4ee; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; }
  h1 { font-size: clamp(1.45rem, 4.5vw, 2rem); font-weight: 800; letter-spacing: -0.02em;
    margin: 14px 0 6px; line-height: 1.2; }
  .meta { font-size: 14px; color: rgba(27, 67, 50, 0.66); }
  .meta b { color: #1b4332; font-weight: 700; }
  .desc { margin: 14px 0 0; font-size: 15px; line-height: 1.65; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 4px; }
  .cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 22px; border-radius: 999px; background: #4a35f0; color: #fff;
    font-weight: 700; font-size: 14px; text-decoration: none; border: 0; }
  .cta.secondary { background: transparent; color: #1b4332; border: 1.5px solid rgba(27, 67, 50, 0.25); }
  .reader { display: block; width: 100%; height: min(78vh, 1100px); margin-top: 18px;
    border: 1px solid rgba(27, 67, 50, 0.12); border-radius: 18px; background: #faf9f6; }
  .note-img { display: block; width: 100%; height: auto; border-radius: 16px;
    border: 1px solid rgba(27, 67, 50, 0.12); margin-top: 14px; }
  .foot { margin-top: 26px; font-size: 13px; color: rgba(27, 67, 50, 0.66); text-align: center; max-width: 860px; }
  .foot a { color: #4a35f0; font-weight: 600; text-decoration: none; }
  .foot .brand { color: #1b4332; font-weight: 800; }
`;

const head = ({ title, description, url, imageUrl, imageAlt }) =>
  `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="noindex" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TestFlow" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`;

const formatSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

const foot = (clientUrl) =>
  `<p class="foot"><span class="brand">TestFlow</span> — past questions and study material for OAU students.<br /><a href="${escapeHtml(
    clientUrl,
  )}">Open the app</a></p>`;

/**
 * A shared book. The PDF is embedded for desktop browsers (their built-in viewer renders it) and
 * offered as a plain download everywhere else, because a phone inside a class WhatsApp group is
 * the common case.
 */
export const bookPageHtml = ({ book, url, cardUrl, fileUrl, downloadUrl, clientUrl }) => {
  const metaParts = [book.author, book.level ? `${book.level} level` : null, formatSize(book.sizeBytes)].filter(Boolean);
  const title = `${book.code} · ${book.title}`;
  const description = `${metaParts.join(' · ')}. On the TestFlow library.`;
  const imageAlt = `TestFlow library: ${title}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${head({ title, description, url, imageUrl: cardUrl, imageAlt })}
    <style>${LAYOUT}</style>
  </head>
  <body>
    <div class="wordmark">TestFlow Library</div>
    <main class="sheet">
      <span class="code">${escapeHtml(book.code)}</span>
      <h1>${escapeHtml(book.title)}</h1>
      <p class="meta">${escapeHtml(metaParts.join(' · '))}${book.pages ? ` · <b>${escapeHtml(String(book.pages))} pages</b>` : ''}</p>
      ${book.description ? `<p class="desc">${escapeHtml(book.description)}</p>` : ''}
      ${
        book.hasFile
          ? `<div class="actions">
        <a class="cta" href="${escapeHtml(downloadUrl)}">Download PDF</a>
        <a class="cta secondary" href="${escapeHtml(fileUrl)}">Read in browser</a>
      </div>
      <iframe class="reader" src="${escapeHtml(fileUrl)}" title="${escapeHtml(title)}"></iframe>`
          : '<p class="desc">The file for this book has not been uploaded yet.</p>'
      }
    </main>
    ${foot(clientUrl)}
  </body>
</html>`;
};

/**
 * A shared note. The whole note is one page — every image, in reading order — because the thing a
 * class group actually opens is "the Lecture 1 note", not one image at a time.
 */
export const notePageHtml = ({ note, url, ogImageUrl, clientUrl }) => {
  const metaParts = [note.subjectCode, note.level ? `${note.level} level` : null, note.semester === 'second' ? 'Second semester' : 'First semester'].filter(Boolean);
  const pageCount = Number(note.imageCount) || 0;
  const title = note.title;
  const description = `${note.subjectCode ?? 'Note'} — ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} of class notes. Shared on TestFlow.`;
  const imageAlt = `TestFlow note: ${title}`;
  const base = url.replace(/\/+$/, '');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${head({ title: `${title} · ${note.subjectCode ?? 'Note'}`, description, url, imageUrl: ogImageUrl, imageAlt })}
    <style>${LAYOUT}</style>
  </head>
  <body>
    <div class="wordmark">TestFlow Notes</div>
    <main class="sheet">
      <span class="code">${escapeHtml(note.subjectCode ?? 'NOTE')}</span>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(metaParts.join(' · '))} · <b>${escapeHtml(String(pageCount))} ${pageCount === 1 ? 'page' : 'pages'}</b></p>
      ${note.description ? `<p class="desc">${escapeHtml(note.description)}</p>` : ''}
      ${
        pageCount === 0
          ? '<p class="desc">This note has no images yet.</p>'
          : Array.from({ length: pageCount }, (_, index) =>
              `<img class="note-img" loading="${index > 1 ? 'lazy' : 'eager'}" src="${escapeHtml(`${base}/image/${index}`)}" alt="Page ${index + 1} of ${escapeHtml(title)}" />`,
            ).join('')
      }
      <div class="actions">
        <a class="cta" href="${escapeHtml(clientUrl)}">Get TestFlow</a>
      </div>
    </main>
    ${foot(clientUrl)}
  </body>
</html>`;
};
