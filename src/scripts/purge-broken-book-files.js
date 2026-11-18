/**
 * Purge the placeholder `fileKey`s left over from the broken upload handler.
 *
 *   node src/scripts/purge-broken-book-files.js            # dry run: list what would change
 *   node src/scripts/purge-broken-book-files.js --yes      # apply: clear the broken keys
 *   node src/scripts/purge-broken-book-files.js --yes --pages   # also delete placeholder BookPage rows
 *
 * Background: the old upload handler set `fileKey: temp-<bookId>` without ever storing the bytes,
 * so every book uploaded through that path points at an object that does not exist. The bytes are
 * unrecoverable; the only fix is to upload the file again. This script flips those books back to
 * the honest "no file yet" state — the reader falls back to placeholder pages, downloads answer
 * plainly instead of signing dead URLs, and the share page hides its file buttons.
 *
 * Placeholder `BookPage` rows are kept by default, on purpose: until you re-upload, they are the
 * only content the in-app reader can show. Pass `--pages` to remove them too.
 *
 * Idempotent: after a run, no key matches `temp-*`, so a second run reports zero.
 */
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { Book } from '../models/Book.js';
import { BookPage } from '../models/BookPage.js';
import { logger } from '../utils/logger.js';

const APPLY = process.argv.includes('--yes');
const PURGE_PAGES = process.argv.includes('--pages');

export async function purgeBrokenBookFiles({ apply = APPLY, purgePages = PURGE_PAGES } = {}) {
  const broken = await Book.find({ fileKey: /^temp-/ }).select('code title createdAt fileKey').lean();
  const report = broken.map((book) => ({
    id: String(book._id),
    code: book.code,
    title: book.title,
    brokenKey: book.fileKey,
    uploadedAt: book.createdAt,
  }));

  logger.info(`Found ${report.length} book(s) pointing at placeholder file keys.`);
  for (const row of report) {
    logger.info(`  · ${row.code} — ${row.title} (${new Date(row.uploadedAt).toISOString().slice(0, 10)}) [${row.brokenKey}]`);
  }

  if (!apply) {
    logger.info('Dry run. Re-run with --yes to clear these keys (fileKey -> null, sizeBytes -> 0).');
    if (PURGE_PAGES) logger.info('--pages noted: placeholder BookPage rows will also be deleted when --yes is passed.');
    return { found: report.length, updated: 0, pagesDeleted: 0, dryRun: true };
  }

  const ids = report.map((row) => row.id);
  let updated = 0;
  if (ids.length) {
    const res = await Book.updateMany({ _id: { $in: ids }, fileKey: /^temp-/ }, { $set: { fileKey: null, sizeBytes: 0 } });
    updated = res.modifiedCount ?? 0;
  }

  let pagesDeleted = 0;
  if (purgePages && ids.length) {
    const res = await BookPage.deleteMany({ book: { $in: ids } });
    pagesDeleted = res.deletedCount ?? 0;
  }

  logger.info(`Done. ${updated} book(s) reset to "no file yet"; ${pagesDeleted} placeholder page(s) deleted.`);
  logger.info('Re-upload the PDFs from the Library admin screen (Edit -> attach PDF -> Save).');
  return { found: report.length, updated, pagesDeleted, dryRun: false };
}

// Run only when invoked directly; importing this module must never connect or write.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  connectDB()
    .then(() => purgeBrokenBookFiles())
    .then(() => disconnectDB())
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Purge failed', error);
      disconnectDB().catch(() => {}).finally(() => process.exit(1));
    });
}
