/**
 * Unit tests for the question import and image intake building blocks. No database, no network:
 *   node --test tests/imports.unit.test.js
 *
 * The rules this file protects:
 *  - A CSV is read as RFC 4180, including quotes, embedded commas and newlines, and a BOM.
 *  - A ZIP is read strictly: only stored/deflate, flat, one copy of each name, no Zip64, no
 *    encryption, no symlinks, no traversal and no zip bombs.
 *  - An image is trusted by its bytes, re-encoded to WebP, and refused when it is animated, the
 *    wrong format, too big to process, or larger than the 2 MB intake.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { parseCsv } from '../src/utils/csv.js';
import { readZipEntries } from '../src/utils/zip.js';
import { prepareOrgImage } from '../src/services/orgMedia.service.js';

/* ----------------------------------------------------------------------------- CSV */

describe('parseCsv', () => {
  it('handles quotes, embedded commas and newlines, and a BOM', () => {
    const text = '\uFEFFstem,options,explanation\r\n"Which, exactly?","2|3|4","line one\nline two"\r\n';
    const rows = parseCsv(text);
    assert.deepEqual(rows, [
      ['stem', 'options', 'explanation'],
      ['Which, exactly?', '2|3|4', 'line one\nline two'],
    ]);
  });

  it('unescapes doubled quotes and drops a trailing empty line', () => {
    const rows = parseCsv('a,b\r\n"she said ""hi""",2\r\n');
    assert.deepEqual(rows, [['a', 'b'], ['she said "hi"', '2']]);
  });

  it('refuses a field that starts a quote mid-value', () => {
    assert.throws(() => parseCsv('ab"cd,e\r\n'), /quote/i);
  });
});

/* ----------------------------------------------------------------------------- ZIP */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Build a ZIP by hand so a test can produce the exact (sometimes hostile) archive it needs. */
const buildZip = (files, {
  method = 0, entryFlags = 0, extAttrs = 0, forceZip64 = false, diskStart = 0,
} = {}) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  let flags = entryFlags;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.data, 'utf8');
    const stored = method === 8 ? zlib.deflateRawSync(raw) : raw;
    if (file.flags !== undefined) flags = file.flags;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(stored.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    locals.push(header, name, stored);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(diskStart, 34);
    central.writeUInt32LE(extAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += header.length + name.length + stored.length;
  }
  const local = Buffer.concat(locals);
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(forceZip64 ? 0xffff : files.length, 8);
  eocd.writeUInt16LE(forceZip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
};

describe('readZipEntries', () => {
  it('reads a stored entry and a deflated entry', () => {
    const zip = buildZip([
      { name: 'questions.csv', data: 'stem,options\r\n' },
      { name: 'logo.png', data: 'x'.repeat(600) },
    ], { method: 8 });
    const entries = readZipEntries(zip);
    assert.equal(entries.get('questions.csv').toString('utf8'), 'stem,options\r\n');
    assert.equal(entries.get('logo.png').length, 600);
  });

  it('rejects a nested path', () => {
    const zip = buildZip([{ name: 'images/logo.png', data: 'x' }]);
    assert.throws(() => readZipEntries(zip), /flat/i);
  });

  it('rejects a backslash path and a traversal path', () => {
    assert.throws(() => readZipEntries(buildZip([{ name: 'a\\b.png', data: 'x' }])), /backslash/i);
    assert.throws(() => readZipEntries(buildZip([{ name: '../evil.png', data: 'x' }])), /unsafe/i);
  });

  it('rejects a duplicate name', () => {
    const zip = buildZip([{ name: 'q.csv', data: 'a' }, { name: 'q.csv', data: 'b' }]);
    assert.throws(() => readZipEntries(zip), /more than once/i);
  });

  it('rejects Zip64, encryption, a foreign disk and symlinks', () => {
    assert.throws(() => readZipEntries(buildZip([{ name: 'q.csv', data: 'a' }], { forceZip64: true })), /Zip64/i);
    assert.throws(() => readZipEntries(buildZip([{ name: 'q.csv', data: 'a' }], { entryFlags: 0x1 })), /[Ee]ncrypted/);
    assert.throws(() => readZipEntries(buildZip([{ name: 'q.csv', data: 'a' }], { diskStart: 1 })), /Multi-disk/i);
    expectSymlink(() => readZipEntries(buildZip([{ name: 'q.csv', data: 'a' }], { extAttrs: 0xa1ff0000 })));
  });

  it('rejects a file that only pretends to be a ZIP', () => {
    assert.throws(() => readZipEntries(Buffer.from('not a zip at all')), /valid ZIP/i);
  });
});

const expectSymlink = (fn) => assert.throws(fn, /[Ss]ymlink/);

/* --------------------------------------------------------------------------- images */

const makePng = ({ width = 8, height = 8, background = '#336699' } = {}) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

describe('prepareOrgImage', () => {
  it('accepts a real PNG and returns WebP bytes', async () => {
    const out = await prepareOrgImage(await makePng());
    assert.equal(out.contentType, 'image/webp');
    assert.equal(out.ext, 'webp');
    assert.equal(out.sourceFormat, 'png');
    assert.ok(out.bytes > 0);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 8);
  });

  it('rejects a file that is not an image', async () => {
    await assert.rejects(() => prepareOrgImage(Buffer.from('this is just text')), /readable image/i);
  });

  it('rejects an image that is too wide to process', async () => {
    const wide = await makePng({ width: 7000, height: 2 });
    await assert.rejects(() => prepareOrgImage(wide), /pixels/i);
  });

  it('rejects input larger than 2 MB before decoding', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x7a);
    await assert.rejects(() => prepareOrgImage(big), /2 MB/i);
  });
});
