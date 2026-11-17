/**
 * Drop the legacy unique index on books.code.
 *   node src/scripts/drop-book-code-unique.js --dry-run   # report only, drops nothing
 *   node src/scripts/drop-book-code-unique.js             # drop it
 *
 * A course code used to be the identity of a book, so `Books` carried a unique `code_1` index.
 * Several books per course are now expected (textbook, slides, past questions), and the model
 * ships a plain `code_1` index instead. Mongoose's autoIndex never drops an index, so the stale
 * unique one survives the schema change and would keep bouncing a second book for the same course
 * with E11000. This runs once per environment. Idempotent: a second run finds nothing to drop.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

export const runMigration = async ({ dryRun = false } = {}) => {
  await connectDB();
  try {
    const coll = mongoose.connection.collection('books');
    const indexes = await coll.indexes();
    const stale = indexes.find((i) => i?.unique && i?.key?.code === 1);
    if (!stale) {
      logger.info('books.code unique index not found; nothing to drop.');
      return { dropped: false, dryRun };
    }
    if (dryRun) {
      logger.info(`would drop unique index "${stale.name}" on books.code`);
      return { dropped: false, dryRun: true, index: stale.name };
    }
    await coll.dropIndex(stale.name);
    logger.info(`dropped unique index "${stale.name}" on books.code`);
    return { dropped: true, index: stale.name };
  } finally {
    await disconnectDB();
  }
};

if (process.argv[1]?.endsWith('drop-book-code-unique.js')) {
  const dryRun = process.argv.includes('--dry-run');
  runMigration({ dryRun }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
