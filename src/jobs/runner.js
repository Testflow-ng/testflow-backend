import os from 'node:os';
import crypto from 'node:crypto';
import { JobLock } from '../models/JobLock.js';
import { JobRun } from '../models/JobRun.js';
import { logger } from '../utils/logger.js';

const OWNER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/** Acquire a lease; returns false if another instance holds a live lease. */
export const acquireLock = async (name, ttlMs) => {
  const now = new Date();
  try {
    const res = await JobLock.findOneAndUpdate(
      { name, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner: OWNER } },
      { upsert: true, new: true },
    );
    return res?.owner === OWNER;
  } catch (e) {
    if (e?.code === 11000) return false; // live lock exists (upsert collided on unique name)
    throw e;
  }
};

export const releaseLock = (name) => JobLock.updateOne({ name, owner: OWNER }, { $set: { lockedUntil: new Date(0) } });

/** Retry an async step with exponential backoff. */
export const withRetry = async (fn, { attempts = 3, baseMs = 250 } = {}) => {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
};

/**
 * Run `task(ctx)` under a lease lock and log a JobRun. `ctx.count(key)` adds to
 * the run's counters, `ctx.fail(msg)` records a (non-fatal) error.
 */
export const runJob = async (name, task, { lockTtlMs = 10 * 60 * 1000 } = {}) => {
  if (!(await acquireLock(name, lockTtlMs))) return null;
  const run = await JobRun.create({ job: name });
  const counts = {};
  const errors = [];
  const ctx = {
    count: (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; },
    fail: (m) => { if (errors.length < 50) errors.push(String(m).slice(0, 300)); },
  };
  let status = 'succeeded';
  try {
    await task(ctx);
    if (errors.length) status = 'partial';
  } catch (e) {
    status = 'failed';
    ctx.fail(e.message);
    logger.error(`[job:${name}] failed`, e);
  } finally {
    await JobRun.updateOne({ _id: run._id }, { $set: { finishedAt: new Date(), status, counts, failures: errors } });
    await releaseLock(name);
  }
  logger.info(`[job:${name}] ${status}`, counts);
  return { status, counts, errors };
};
