#!/usr/bin/env node
/**
 * Subject Course-Level Migration
 *
 * Safely classifies and corrects Subject.level based on the numeric component
 * of Subject.code using the rules:
 *   1xx -> 100, 2xx -> 200, 3xx -> 300, 4xx -> 400, 5xx -> 500, 6xx -> 600
 * Post-UTME courses are left unchanged (existing 'post-utme' values are preserved).
 *
 * Default: dry-run (no DB writes). Use --apply to modify records.
 * Idempotent. Never modifies unrelated fields or other collections.
 */
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Subject } from '../models/Subject.js';

const VALID_LEVELS = new Set(['100', '200', '300', '400', '500', '600']);
const POST_UTME_LEVEL = 'post-utme';

function extractNumericPart(code) {
  if (!code || typeof code !== 'string') return null;
  const s = code.trim();
  if (!s) return null;
  // Match sequences of digits (handles spaces/hyphens)
  const matches = s.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  if (matches.length > 1) {
    // Ambiguous if multiple number groups
    return { numeric: null, ambiguous: true };
  }
  return { numeric: matches[0], ambiguous: false };
}

function classifyLevelFromCode(code) {
  const res = extractNumericPart(code);
  if (!res) return { expected: null, reason: 'no_numeric_component' };
  if (res.ambiguous) return { expected: null, reason: 'ambiguous_numeric_format' };
  if (!/^\d+$/.test(res.numeric)) return { expected: null, reason: 'invalid_numeric_format' };
  const first = res.numeric[0];
  if (first === '1') return { expected: '100', reason: 'numeric_starts_with_1' };
  if (first === '2') return { expected: '200', reason: 'numeric_starts_with_2' };
  if (first === '3') return { expected: '300', reason: 'numeric_starts_with_3' };
  if (first === '4') return { expected: '400', reason: 'numeric_starts_with_4' };
  if (first === '5') return { expected: '500', reason: 'numeric_starts_with_5' };
  if (first === '6') return { expected: '600', reason: 'numeric_starts_with_6' };
  return { expected: null, reason: `unsupported_first_digit_${first}` };
}

function isProdUri(uri) {
  if (!uri) return false;
  // Heuristic only; project policy still requires explicit approval for production migrations.
  const u = uri.toLowerCase();
  return u.includes('prod') || u.includes('live') || u.includes('atlas') && !u.includes('test');
}

async function run() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');

  const uri = config.MONGODB_URI;
  if (apply && isProdUri(uri)) {
    console.error('[migrate-subject-levels] Refusing to apply against a production-like URI. Use --apply only with an explicitly approved migration procedure.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    const subjects = await Subject.find({}).lean();
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      totalInspected: subjects.length,
      alreadyCorrect: 0,
      missingLevel: 0,
      incorrectLevel: 0,
      requiringCorrection: 0,
      skippedAmbiguousOrUnclassifiable: 0,
      updates: [],
      skipped: [],
      failures: [],
      summaryByLevel: { '100': 0, '200': 0, '300': 0, '400': 0, '500': 0, '600': 0 },
    };

    for (const subj of subjects) {
      if (subj.level === POST_UTME_LEVEL) {
        report.skipped.push({ id: String(subj._id), code: subj.code, level: subj.level, reason: 'post_utme_preserved' });
        continue;
      }
      const cls = classifyLevelFromCode(subj.code);
      if (!cls.expected || !VALID_LEVELS.has(cls.expected)) {
        report.skippedAmbiguousOrUnclassifiable += 1;
        report.skipped.push({ id: String(subj._id), code: subj.code, level: subj.level ?? null, reason: cls.reason });
        continue;
      }
      if (subj.level == null || subj.level === '') {
        report.missingLevel += 1;
        report.requiringCorrection += 1;
        report.updates.push({ id: String(subj._id), code: subj.code, currentLevel: subj.level ?? null, proposedLevel: cls.expected, reason: cls.reason });
        report.summaryByLevel[cls.expected] += 1;
      } else if (subj.level !== cls.expected) {
        report.incorrectLevel += 1;
        report.requiringCorrection += 1;
        report.updates.push({ id: String(subj._id), code: subj.code, currentLevel: subj.level, proposedLevel: cls.expected, reason: cls.reason });
        report.summaryByLevel[cls.expected] += 1;
      } else {
        report.alreadyCorrect += 1;
      }
    }

    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      console.log('\n[DRY-RUN] No changes written. Run with --apply to apply updates.');
      return;
    }

    const migrationLog = [];
    for (const upd of report.updates) {
      try {
        const before = await Subject.findById(upd.id).select('code level').lean();
        const res = await Subject.updateOne({ _id: upd.id }, { $set: { level: upd.proposedLevel } });
        if (res.modifiedCount === 1) {
          migrationLog.push({ ...upd, previousLevel: before?.level ?? upd.currentLevel, appliedAt: new Date().toISOString() });
        } else {
          report.failures.push({ ...upd, error: 'no_document_modified' });
        }
      } catch (err) {
        report.failures.push({ ...upd, error: err.message });
      }
    }

    const finalReport = { ...report, applied: migrationLog.length, migrationLog };
    console.log(JSON.stringify(finalReport, null, 2));
    if (report.failures.length > 0) {
      console.error(`\n[MIGRATION] Completed with ${report.failures.length} failure(s).`);
      process.exitCode = 1;
    } else {
      console.log(`\n[MIGRATION] Applied ${migrationLog.length} update(s) successfully.`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
