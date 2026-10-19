import { AppError } from '../utils/AppError.js';
import { parseCsv } from '../utils/csv.js';
import { readZipEntries } from '../utils/zip.js';
import { prepareOrgImage, storeOrgImage } from './orgMedia.service.js';
import { importQuestionRows } from './orgContent.service.js';

/**
 * CSV and ZIP question import.
 *
 * One multipart endpoint accepts either a plain `.csv` or a ZIP holding `questions.csv` plus the
 * images it references. A ZIP is parsed entirely in memory (see `utils/zip.js`); nothing is written
 * to disk, and the archive is only ever read for the exact file names the CSV asks for.
 *
 * A bad row is reported with its real spreadsheet line and does not sink the rest of the file.
 * `?dryRun=true` runs the same validation (including image decoding) and writes nothing.
 */

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const REQUIRED_HEADERS = ['stem', 'options', 'correctIndex'];

const HEADER_ALIASES = Object.freeze({
  stem: 'stem',
  question: 'stem',
  options: 'options',
  choices: 'options',
  correctindex: 'correctIndex',
  correct: 'correctIndex',
  answer: 'correctIndex',
  explanation: 'explanation',
  topic: 'topic',
  subject: 'topic',
  difficulty: 'difficulty',
  stemimage: 'stemImage',
  questionimage: 'stemImage',
  optionimages: 'optionImages',
});

const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');

const splitPipe = (value) => String(value ?? '')
  .split('|')
  .map((part) => part.trim())
  .filter((part) => part !== '');

const isZip = (buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

const csvRowsToEntries = (csvText) => {
  let rows;
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    throw new AppError(422, 'INVALID_CSV', `The CSV could not be read: ${error.message}`);
  }
  if (rows.length < 2) throw new AppError(422, 'INVALID_CSV', 'The CSV has no question rows.');

  const header = rows[0].map((cell) => HEADER_ALIASES[normalizeHeader(cell)] ?? normalizeHeader(cell));
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) throw new AppError(422, 'INVALID_CSV', `The CSV is missing the "${required}" column.`);
  }

  return rows.slice(1).map((cells, index) => {
    const record = Object.fromEntries(header.map((key, column) => [key, cells[column] ?? '']));
    return { row: index + 2, record };
  });
};

const buildData = (record, resolveImage, { allowImages }) => {
  const options = splitPipe(record.options);
  const optionImageNames = splitPipe(record.optionImages);
  const stemImage = String(record.stemImage ?? '').trim();

  if ((stemImage || optionImageNames.length) && !allowImages) {
    throw new AppError(422, 'IMAGES_REQUIRE_ZIP', 'Image columns need a ZIP upload that also contains the images.');
  }

  const optionImages = options.map(() => null);
  if (optionImageNames.length) {
    if (optionImageNames.length !== options.length) {
      throw new AppError(422, 'VALIDATION_ERROR', 'optionImages must have one file name per option.');
    }
    optionImageNames.forEach((name, index) => {
      optionImages[index] = resolveImage(name);
    });
  }

  return {
    stem: String(record.stem ?? '').trim(),
    options,
    optionImages,
    correctIndex: record.correctIndex === '' ? NaN : Number(record.correctIndex),
    explanation: String(record.explanation ?? '').trim(),
    topic: String(record.topic ?? '').trim(),
    difficulty: String(record.difficulty ?? '').trim() || undefined,
    stemImageUrl: stemImage ? resolveImage(stemImage) : null,
  };
};

/**
 * @param {object} org the resolved organisation
 * @param {Buffer} buffer the uploaded file
 * @param {{ examId?: string, bankId?: string, dryRun?: boolean, actorId?: string }} options
 */
export const importQuestionsFile = async (org, buffer, { examId, bankId, dryRun = false, actorId } = {}) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError(422, 'INVALID_UPLOAD', 'Send a CSV or ZIP file.');
  if (buffer.length > MAX_CSV_BYTES) throw new AppError(422, 'FILE_TOO_LARGE', 'Imports must be 10 MB or smaller.');

  const zipped = isZip(buffer);
  let csvText;
  let images = new Map();

  if (zipped) {
    images = readZipEntries(buffer);
    const csv = images.get('questions.csv');
    if (!csv) throw new AppError(422, 'INVALID_ARCHIVE', 'The ZIP must contain a "questions.csv" at the top level.');
    csvText = csv.toString('utf8');
  } else {
    csvText = buffer.toString('utf8');
  }

  const records = csvRowsToEntries(csvText);
  const entries = [];
  const failed = [];

  for (const { row, record } of records) {
    try {
      const resolveImage = (name) => {
        const entry = images.get(name);
        if (!entry) throw new AppError(422, 'IMAGE_NOT_FOUND', `"${name}" is not in the ZIP.`);
        return entry;
      };
      const data = buildData(record, (name) => {
        const entry = resolveImage(name);
        // Return the name here; storage happens once the row has passed every other check.
        return entry;
      }, { allowImages: zipped });

      // Store (or, on a dry run, just decode) the referenced images before the row is accepted.
      const imagesToStore = [
        { holder: data, key: 'stemImageUrl' },
        ...data.options.map((_option, index) => ({ holder: data.optionImages, key: index })),
      ];
      for (const target of imagesToStore) {
        const value = target.holder === data ? data[target.key] : target.holder[target.key];
        if (!Buffer.isBuffer(value)) continue;
        if (dryRun) {
          await prepareOrgImage(value);
          const marker = `dry-run-${target.key}`;
          if (target.holder === data) data[target.key] = marker;
          else target.holder[target.key] = marker;
        } else {
          const stored = await storeOrgImage(org, { buffer: value, size: value.length, mimetype: 'application/octet-stream' }, 'image', actorId);
          if (target.holder === data) data[target.key] = stored.url;
          else target.holder[target.key] = stored.url;
        }
      }

      // A null stemImageUrl is the same as "no image" to `assertQuestion`.
      if (!data.stemImageUrl) delete data.stemImageUrl;
      const optionImages = data.optionImages.map((url) => (typeof url === 'string' && url.startsWith('dry-run-') ? null : url));
      entries.push({ row, data: { ...data, optionImages } });
    } catch (error) {
      failed.push({ row, problems: [error.message] });
    }
  }

  const result = await importQuestionRows(org._id, entries, actorId, { examId, bankId, dryRun });
  return {
    format: zipped ? 'zip' : 'csv',
    imported: result.imported,
    valid: result.valid,
    dryRun: result.dryRun,
    failed: [...failed, ...result.failed].sort((a, b) => a.row - b.row),
  };
};

export const CSV_TEMPLATE = [
  'stem,options,correctIndex,explanation,topic,difficulty,stemImage,optionImages',
  '"Which of these numbers is prime?","2|3|4|6",0,"2 is the only even prime.","Number theory","easy","",""',
].join('\r\n') + '\r\n';
