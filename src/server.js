import app from './app.js';
import { config } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './utils/logger.js';

const start = async () => {
  await connectDB();

  const server = app.listen(config.PORT, () => {
    logger.info(`TestFlow API listening on port ${config.PORT} [${config.NODE_ENV}]`);
  });

  const shutdown = (signal) => {
    logger.warn(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Force-exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  ['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

  // Log unhandled rejections but keep serving — one stray rejection must not
  // take the whole API down.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });

  // An uncaught synchronous exception leaves the process in an undefined state:
  // log and shut down in a controlled way.
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('uncaughtException');
  });
};

start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
