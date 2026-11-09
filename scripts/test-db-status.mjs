#!/usr/bin/env node
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI_TEST;
if (!uri) {
  console.error('MONGODB_URI_TEST is not set. Load .env.test (e.g. node --env-file=.env.test scripts/test-db-status.mjs).');
  process.exit(1);
}

let dbName = 'unknown';
try { dbName = new URL(uri).pathname.replace(/^\//, '') || 'unknown'; } catch {}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const admin = mongoose.connection.db.admin();
  const ping = await admin.ping();
  const stats = await mongoose.connection.db.stats();
  console.log(JSON.stringify({
    ok: ping?.ok === 1,
    uriHost: (() => { try { return new URL(uri).host; } catch { return 'unknown'; } })(),
    dbName,
    collections: stats.collections,
    objects: stats.objects,
    dataSize: stats.dataSize,
  }, null, 2));
} catch (err) {
  console.error(`MongoDB test DB unavailable: ${err.message}`);
  process.exit(1);
} finally {
  await mongoose.disconnect().catch(() => {});
}
