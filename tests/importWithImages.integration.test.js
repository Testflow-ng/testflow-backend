import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { importQuestionsFile, MAX_IMAGE_BYTES } from '../src/services/orgQuestionImport.service.js';

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#6b5bd2' } }).png().toBuffer();
const csv = (rows) => Buffer.from(['stem,options,correctIndex,stemImage,optionImages', ...rows, ''].join('\r\n'));
const org = { _id: '64b000000000000000000001' };

describe('import with pictures beside the CSV', () => {
  before(async () => { await mongoose.connect(process.env.MONGODB_URI ?? process.env.MONGO_URI); });
  after(async () => { await mongoose.disconnect(); });

  it('matches pictures by name, reports a missing one, and lists unused ones (dry run)', async () => {
    const good = await png();
    const result = await importQuestionsFile(
      org,
      csv(['"Which shape?","A|B",0,q1.png,"a.png|b.png"', '"Missing pic","A|B",0,gone.png,""']),
      { dryRun: true, extraImages: new Map([['q1.png', good], ['a.png', good], ['b.png', good], ['spare.png', good]]) },
    );
    assert.equal(result.format, 'csv+images');
    assert.equal(result.valid, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].row, 3);
    assert.match(result.failed[0].problems[0], /gone\.png/);
    assert.deepEqual(result.unusedImages, ['spare.png']);
  });

  it('rejects a picture over 1 MB and a fake image', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1);
    await assert.rejects(importQuestionsFile(org, csv(['"Q","A|B",0,big.png,""']), { dryRun: true, extraImages: new Map([['big.png', big]]) }), { code: 'FILE_TOO_LARGE' });

    const fake = await importQuestionsFile(org, csv(['"Q","A|B",0,fake.png,""']), { dryRun: true, extraImages: new Map([['fake.png', Buffer.from('<svg onload=alert(1)>')]]) });
    assert.equal(fake.valid, 0);
    assert.equal(fake.failed.length, 1);
  });

  it('refuses image columns when no pictures were sent', async () => {
    const result = await importQuestionsFile(org, csv(['"Q","A|B",0,q1.png,""']), { dryRun: true });
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].problems[0], /ZIP|picture/i);
  });
});

describe('picture-only options', () => {
  before(async () => { await mongoose.connect(process.env.MONGODB_URI ?? process.env.MONGO_URI); });
  after(async () => { await mongoose.disconnect(); });

  it('keeps option slots in place when only some options have a picture', async () => {
    const good = await png();
    const result = await importQuestionsFile(org, csv(['"Pick the shape","Triangle|",0,"","a.png|b.png"']), { dryRun: true, extraImages: new Map([['a.png', good], ['b.png', good]]) });
    assert.equal(result.valid, 1, JSON.stringify(result.failed));
  });
});
