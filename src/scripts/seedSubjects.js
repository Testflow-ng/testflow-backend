import { connectDB, disconnectDB } from '../config/db.js';
import { Subject } from '../models/Subject.js';
import { logger } from '../utils/logger.js';

// The fixed course list. Titles are sensible defaults an admin can edit later.
const SUBJECTS = [
  { code: 'PHY102', title: 'General Physics II' },
  { code: 'ACC102', title: 'Principles of Accounting II' },
  { code: 'MTH102', title: 'Elementary Mathematics II' },
  { code: 'EGL102', title: 'Use of English II' },
  { code: 'PHL102', title: 'Introduction to Logic and Philosophy' },
  { code: 'CHM102', title: 'General Chemistry II' },
  { code: 'STA112', title: 'Probability and Statistics I' },
  { code: 'GST112', title: 'Nigerian Peoples and Culture' },
];

const run = async () => {
  await connectDB();
  // Idempotent: insert missing subjects, never overwrite admin-edited titles.
  for (const subject of SUBJECTS) {
    await Subject.updateOne({ code: subject.code }, { $setOnInsert: subject }, { upsert: true });
  }
  logger.info(`Seeded ${SUBJECTS.length} subjects.`);
  await disconnectDB();
  process.exit(0);
};

run().catch(async (error) => {
  logger.error('Subject seed failed', error);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
