import { connectDB, disconnectDB } from '../config/db.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
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

// Sample practice questions per subject. The exam engine shuffles option order
// per attempt, so the stored answer position is not exposed to students.
const QUESTIONS = {
  // Questions should be added via Admin UI or specialized seed scripts.
};

const run = async () => {
  await connectDB();

  // Subjects: insert missing, never overwrite admin-edited titles.
  for (const subject of SUBJECTS) {
    await Subject.updateOne({ code: subject.code }, { $setOnInsert: subject }, { upsert: true });
  }
  logger.info(`Seeded ${SUBJECTS.length} subjects.`);

  // Questions: insert missing (idempotent by subject + stem); full validation runs on create.
  let inserted = 0;
  let skipped = 0;
  for (const [code, questions] of Object.entries(QUESTIONS)) {
    const subject = await Subject.findOne({ code });
    if (!subject) {
      logger.warn(`Subject ${code} not found; skipping its questions.`);
      continue;
    }
    for (const question of questions) {
      const exists = await Question.findOne({ subject: subject._id, stem: question.stem });
      if (exists) {
        skipped += 1;
        continue;
      }
      await Question.create({
        subject: subject._id,
        stem: question.stem,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        difficulty: question.difficulty ?? 'medium',
      });
      inserted += 1;
    }
  }
  logger.info(`Questions seeded: ${inserted} inserted, ${skipped} already present.`);

  await disconnectDB();
  process.exit(0);
};

run().catch(async (error) => {
  logger.error('Seed failed', error);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
