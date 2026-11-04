import mongoose from 'mongoose';

/** Lease lock so only one API instance runs a scheduled job at a time. */
const jobLockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, required: true },
    owner: String,
  },
  { versionKey: false },
);

export const JobLock = mongoose.model('JobLock', jobLockSchema);
