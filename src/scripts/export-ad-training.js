/**
 * Export anonymized ad decisions as JSONL for model training.
 *   node src/scripts/export-ad-training.js --out data/ad-training.jsonl [--from 2026-01-01] [--to 2026-02-01] [--served-only] [--limit 50000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDB, disconnectDB } from '../config/db.js';
import { streamTrainingRecords } from '../services/ads/decisionLog.service.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const out = arg('out') ?? 'ad-training.jsonl';

await connectDB();
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const stream = fs.createWriteStream(out);
const count = await streamTrainingRecords(
  { from: arg('from') && new Date(arg('from')), to: arg('to') && new Date(arg('to')), includeNoAd: !process.argv.includes('--served-only'), limit: Number(arg('limit') ?? 50000) },
  (rec) => new Promise((resolve) => { stream.write(`${JSON.stringify(rec)}\n`) ? resolve() : stream.once('drain', resolve); }),
);
await new Promise((r) => stream.end(r));
console.log(`Wrote ${count} records to ${out}`);
await disconnectDB();
