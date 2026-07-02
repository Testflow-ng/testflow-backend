import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
// Strip query operators ($gt, $where, ...) from filter objects as a second line
// of defense against NoSQL operator injection.
mongoose.set('sanitizeFilter', true);

export async function connectDB() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', err));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(config.MONGODB_URI);
}

export async function disconnectDB() {
  await mongoose.connection.close();
}
