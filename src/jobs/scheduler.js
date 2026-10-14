import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runLifecycle } from './lifecycle.job.js';
import { runRetention } from './retention.job.js';

const timers = [];

/**
 * In-process scheduler (the project has no queue/worker infrastructure). Each
 * tick takes a Mongo lease lock, so running multiple API instances is safe.
 */
export const startAdsScheduler = () => {
  if (config.ADS_JOBS_ENABLED !== 'true' || config.isTest) return;
  const safe = (fn, name) => () => fn().catch((e) => logger.error(`[job:${name}] tick error`, e));
  timers.push(setInterval(safe(runLifecycle, 'ads-lifecycle'), 60 * 1000));
  timers.push(setInterval(safe(runRetention, 'ads-retention'), 60 * 60 * 1000));
  // First pass shortly after boot catches anything missed while the server was down.
  timers.push(setTimeout(safe(runLifecycle, 'ads-lifecycle'), 5_000));
  timers.push(setTimeout(safe(runRetention, 'ads-retention'), 30_000));
  timers.forEach((t) => t.unref());
  logger.info('Ads scheduler started (lifecycle: 1m, retention: 1h)');
};

export const stopAdsScheduler = () => timers.splice(0).forEach((t) => { clearInterval(t); clearTimeout(t); });
