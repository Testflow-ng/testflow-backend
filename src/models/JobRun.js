import mongoose from 'mongoose';

/** Execution log for scheduled jobs (lifecycle + retention). */
const jobRunSchema = new mongoose.Schema(
  {
    job: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    status: { type: String, enum: ['running', 'succeeded', 'partial', 'failed'], default: 'running' },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    failures: { type: [String], default: [] },
  },
  { versionKey: false },
);

jobRunSchema.index({ job: 1, startedAt: -1 });
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // keep 90 days of run logs

export const JobRun = mongoose.model('JobRun', jobRunSchema);
