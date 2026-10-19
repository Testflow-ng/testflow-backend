import zlib from 'node:zlib';
import { AppError } from './AppError.js';

/**
 * A deliberately small, strict in-memory ZIP reader for question imports.
 *
 * It exists so an uploaded archive is never written to disk and never handed to a general-purpose
 * extractor: only stored (0) and deflate (8) entries are allowed, and anything a question import
 * has no business containing is a hard error rather than something to ignore:
 *
 *  - encrypted entries, Zip64, multi-disk, and per-entry disk spans
 *  - symlinks and other non-regular Unix modes
 *  - absolute paths, `..` traversal, backslashes and nested directories
 *  - duplicate names and control characters in names
 *  - per-entry and total uncompressed ceilings, plus an inflation-ratio guard (zip bombs)
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const MAX_ENTRIES = 200;
const MAX_UNCOMPRESSED_TOTAL = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_RATIO = 200;

const bad = (code, message) => new AppError(422, code, message);

const findEocd = (buffer) => {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
};

const hasControlCharacter = (name) => {
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) < 0x20) return true;
  }
  return false;
};

const assertSafeName = (name) => {
  if (!name || name.length > 255) throw bad('INVALID_ARCHIVE', 'The archive contains an invalid file name.');
  if (hasControlCharacter(name)) throw bad('INVALID_ARCHIVE', 'The archive contains a control character in a file name.');
  if (name.startsWith('/') || name.startsWith('\\')) throw bad('INVALID_ARCHIVE', 'The archive contains an absolute path.');
  if (name.includes('\\')) throw bad('INVALID_ARCHIVE', 'The archive contains a backslash path.');
  if (name === '.' || name === '..' || name.includes('..')) throw bad('INVALID_ARCHIVE', 'The archive contains an unsafe path.');
  if (name.includes('/')) throw bad('NESTED_ARCHIVE', 'The archive must be flat: put every file at the top level.');
};

/**
 * Extract every entry into a `Map<name, Buffer>`.
 * @param {Buffer} buffer the raw archive
 */
export const readZipEntries = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw bad('INVALID_ARCHIVE', 'That file is not a valid ZIP archive.');
  const eocd = findEocd(buffer);
  if (eocd < 0) throw bad('INVALID_ARCHIVE', 'That file is not a valid ZIP archive.');

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const diskWithCd = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  if (diskNumber !== 0 || diskWithCd !== 0 || entriesOnDisk !== totalEntries) {
    throw bad('INVALID_ARCHIVE', 'Multi-disk archives are not supported.');
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw bad('ZIP64_UNSUPPORTED', 'Zip64 archives are not supported.');
  }
  if (totalEntries > MAX_ENTRIES) throw bad('ARCHIVE_TOO_LARGE', `The archive has too many files (max ${MAX_ENTRIES}).`);
  if (cdOffset + cdSize > buffer.length) throw bad('INVALID_ARCHIVE', 'The archive directory is truncated.');

  const entries = new Map();
  let offset = cdOffset;
  let total = 0;

  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CD_SIG) {
      throw bad('INVALID_ARCHIVE', 'The archive directory is malformed.');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const uncompSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const extAttrs = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw bad('ZIP64_UNSUPPORTED', 'Zip64 archives are not supported.');
    }
    if (flags & 0x1) throw bad('ENCRYPTED_ARCHIVE', 'Encrypted archives are not supported.');
    if (diskStart !== 0) throw bad('INVALID_ARCHIVE', 'Multi-disk archives are not supported.');
    if (method !== 0 && method !== 8) throw bad('INVALID_ARCHIVE', 'The archive uses an unsupported compression method.');
    if (((extAttrs >>> 16) & 0xf000) === 0xa000) throw bad('INVALID_ARCHIVE', 'Symlinks are not allowed in an archive.');

    assertSafeName(name);
    if (entries.has(name)) throw bad('DUPLICATE_ENTRY', `The archive contains "${name}" more than once.`);
    if (uncompSize > MAX_ENTRY_BYTES) throw bad('ARCHIVE_TOO_LARGE', `"${name}" is larger than the per-file limit.`);
    if (compSize > 0 && uncompSize / compSize > MAX_RATIO) throw bad('ARCHIVE_BOMB', 'The archive looks like a zip bomb.');
    total += uncompSize;
    if (total > MAX_UNCOMPRESSED_TOTAL) throw bad('ARCHIVE_TOO_LARGE', 'The archive expands to more than the allowed size.');

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw bad('INVALID_ARCHIVE', 'The archive entry is malformed.');
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buffer.length) throw bad('INVALID_ARCHIVE', 'The archive entry is truncated.');
    const compressed = buffer.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else {
      try {
        data = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw bad('INVALID_ARCHIVE', `"${name}" could not be decompressed.`);
      }
    }
    if (data.length !== uncompSize) throw bad('INVALID_ARCHIVE', `"${name}" has an inconsistent size.`);
    entries.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
};
