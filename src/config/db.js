import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
// NOTE: global `sanitizeFilter` is intentionally NOT enabled — it wraps our own
// legitimate operator queries (e.g. `{ expiresAt: { $gt: now } }`) and breaks
// them. NoSQL operator injection is already prevented at the validation layer:
// every user input is typed via strict zod schemas, so no attacker-controlled
// object can reach a query filter.

export async function connectDB() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', err));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(config.MONGODB_URI);
}

export async function disconnectDB() {
  await mongoose.connection.close();
}
