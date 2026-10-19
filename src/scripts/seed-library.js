/**
 * Seed the Library shelf.
 *
 *   node src/scripts/seed-library.js
 *
 * The redesigned student app ships with these 18 books, so a fresh database has a real shelf to
 * browse rather than an empty state nobody can click. Idempotent: a book is upserted by its course
 * code and each page by its number, so re-running repairs the shelf instead of duplicating it.
 *
 * Two deliberate choices:
 *  - The page text is generated placeholder content, labelled as such in the text itself. The real
 *    content arrives from the book pipeline.
 *  - `fileKey` is left null, so `GET /api/library/books/:id/download` answers
 *    `403 DOWNLOAD_NOT_AVAILABLE` until a real PDF is uploaded to R2 and the key is set on the
 *    book. That is the honest state: no file exists yet, so no link is minted.
 */
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { Book } from '../models/Book.js';
import { BookPage } from '../models/BookPage.js';
import { logger } from '../utils/logger.js';

const book = (code, title, subtitle, color, level, semester, pages, sizeKb, edition, topics) => ({
  code,
  title,
  subtitle,
  color,
  level,
  semester,
  pages,
  sizeBytes: sizeKb * 1024,
  edition,
  author: 'TestFlow Editorial',
  year: 2024,
  topics,
  description: `A ${level} level, ${semester} semester companion for ${code}, covering ${topics
    .slice(0, 3)
    .join(', ')
    .toLowerCase()} with worked examples and past-question walkthroughs.`,
  published: true,
  fileKey: null,
});

/** Approved books, and the only seed. Exported so tests can reuse the same shelf. */
export const LIBRARY_SEED = [
  book('MTH101', 'Elementary Mathematics I', 'Algebra, calculus and statistics', 'red', 100, 'first', 148, 4210, '2nd edition', ['Algebra', 'Calculus', 'Statistics']),
  book('GST101', 'Use of English I', 'Grammar, comprehension and usage', 'blue', 100, 'first', 96, 2860, '3rd edition', ['Grammar', 'Comprehension', 'Usage']),
  book('CHM101', 'General Chemistry I', 'Atoms, reactions and equations', 'ink', 100, 'first', 172, 5140, '2nd edition', ['Atomic structure', 'Bonding', 'Stoichiometry']),
  book('BIO101', 'General Biology I', 'Cells, genetics and ecology', 'green', 100, 'first', 164, 4980, '2nd edition', ['Cells', 'Genetics', 'Ecology']),
  book('PHY101', 'General Physics I', 'Mechanics, heat and waves', 'amber', 100, 'first', 188, 6020, '2nd edition', ['Mechanics', 'Heat', 'Waves']),
  book('CSC101', 'Introduction to Computing', 'Hardware, software and problem solving', 'violet', 100, 'first', 120, 3520, '1st edition', ['Hardware', 'Software', 'Algorithms']),
  book('STA101', 'Statistics for Science', 'Describing and presenting data', 'teal', 100, 'second', 132, 3880, '1st edition', ['Data', 'Averages', 'Charts']),
  book('MTH102', 'Elementary Mathematics II', 'Vectors, series and coordinate geometry', 'red', 100, 'second', 156, 4460, '2nd edition', ['Vectors', 'Series', 'Geometry']),
  book('GST102', 'Use of English II', 'Essay writing and comprehension', 'blue', 100, 'second', 88, 2640, '3rd edition', ['Essay', 'Summary', 'Comprehension']),
  book('CHM102', 'General Chemistry II', 'Organic and physical chemistry', 'ink', 100, 'second', 168, 5020, '2nd edition', ['Organic', 'Equilibria', 'Energetics']),
  book('BIO102', 'General Biology II', 'Form and function in living things', 'green', 100, 'second', 176, 5260, '2nd edition', ['Plants', 'Animals', 'Evolution']),
  book('PHY102', 'General Physics II', 'Electricity, magnetism and optics', 'amber', 100, 'second', 192, 6140, '2nd edition', ['Electricity', 'Magnetism', 'Optics']),
  book('CSC102', 'Programming Fundamentals', 'First steps in problem solving with code', 'violet', 100, 'second', 140, 4120, '1st edition', ['Variables', 'Control flow', 'Functions']),
  book('STA102', 'Probability', 'Chance, counting and distributions', 'teal', 200, 'first', 144, 4280, '1st edition', ['Chance', 'Counting', 'Distributions']),
  book('MTH201', 'Mathematical Methods I', 'Sequences, series and differential equations', 'red', 200, 'first', 204, 6840, '1st edition', ['Sequences', 'Series', 'ODE']),
  book('BIO201', 'Genetics', 'Inheritance from Mendel onwards', 'green', 200, 'first', 158, 4680, '1st edition', ['Inheritance', 'DNA', 'Mutation']),
  book('CHM201', 'Organic Chemistry', 'Structure, naming and reactions', 'ink', 200, 'first', 212, 7120, '1st edition', ['Structure', 'Naming', 'Reactions']),
  book('PHY201', 'Classical Mechanics', 'Motion, forces and energy', 'amber', 200, 'first', 196, 6380, '1st edition', ['Motion', 'Forces', 'Energy']),
];

/** Placeholder page text, cycling through the book's own topics. */
const pageBlocks = (entry, page) => {
  const topic = entry.topics[(page - 1) % entry.topics.length] ?? entry.title;
  return [
    { type: 'heading', text: `${topic} (${entry.code}, page ${page})` },
    {
      type: 'paragraph',
      text: `Placeholder content for ${entry.code}. ${entry.title} runs to ${entry.pages} pages; the published text replaces this when the book is imported.`,
    },
    {
      type: 'paragraph',
      text: `Work through the examples on this page, then check your understanding against the past questions tagged ${topic.toLowerCase()}.`,
    },
  ];
};

/** Upsert the shelf and its pages. The caller owns the connection (like `seedPlans`). */
export async function seedLibrary() {
  let pages = 0;
  for (const entry of LIBRARY_SEED) {
    const doc = await Book.findOneAndUpdate(
      { code: entry.code },
      { $set: entry, $setOnInsert: { publishedAt: new Date() } },
      { upsert: true, new: true },
    );

    const ops = [];
    for (let page = 1; page <= doc.pages; page += 1) {
      ops.push({
        updateOne: {
          filter: { book: doc._id, page },
          update: { $set: { blocks: pageBlocks(entry, page) } },
          upsert: true,
        },
      });
    }
    if (ops.length) {
      await BookPage.bulkWrite(ops, { ordered: false });
      pages += ops.length;
    }
  }
  return { books: LIBRARY_SEED.length, pages };
}

// Run only when invoked directly; importing this module must never connect or write.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const run = async () => {
    await connectDB();
    const { books, pages } = await seedLibrary();
    logger.info(`Seeded ${books} library books and ${pages} pages.`);
    await disconnectDB();
    process.exit(0);
  };
  run().catch(async (error) => {
    logger.error('Library seed failed', error);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
}
