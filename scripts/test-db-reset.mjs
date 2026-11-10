#!/usr/bin/env node
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI_TEST;
if (!uri) {
  console.error('MONGODB_URI_TEST is not set. Load .env.test first.');
  process.exit(1);
}

let dbName = '';
let host = '';
try {
  const u = new URL(uri);
  host = u.hostname;
  dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
} catch {
  console.error('MONGODB_URI_TEST is not a valid MongoDB URI.');
  process.exit(1);
}

if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to reset non-local MongoDB host: ${host}`);
  process.exit(1);
}
if (!dbName || !/(^testflow_test$|_test$|test$)/i.test(dbName)) {
  console.error(`Refusing to reset database "${dbName}". MONGODB_URI_TEST must point to a dedicated test database.`);
  process.exit(1);
}
if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
  console.error('Refusing: MONGODB_URI_TEST equals MONGODB_URI.');
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  console.log(`Dropped test database: ${dbName}`);
} catch (err) {
  console.error(`Failed to reset test DB: ${err.message}`);
  process.exit(1);
} finally {
  await mongoose.disconnect().catch(() => {});
}
