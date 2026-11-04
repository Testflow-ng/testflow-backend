import mongoose from 'mongoose';

export const FLAG_REASONS = Object.freeze([
  'wrong_answer',
  'typo',
  'out_of_syllabus',
  'duplicate',
  'other',
]);

export const FLAG_STATUSES = Object.freeze(['open', 'resolved', 'dismissed']);

/**
 * A student's report that a *question* is broken.
 *
 * Deliberately not the paper's own `markedForReview`: that is a private note to come back to
 * during the sitting and it dies with the attempt. This outlives every attempt and is worked by
 * whoever owns the question bank. It is also a separate collection from product feedback (see
 * `models/Feedback.js`): a report is about a question, feedback is about the app.
 *
 * One row per student per question. Flagging the same question again *updates* the reason and
 * the note, because a count of taps is not worth reading and a count of students is. That is what
 * the unique index below enforces.
 *
 * `reporter` freezes the student's identity as it was when they reported: a later profile edit
 * must not rewrite what an admin was shown.
 */
const reporterSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, maxlength: 120 },
    username: { type: String, trim: true, maxlength: 60 },
    matricNumber: { type: String, trim: true, maxlength: 40 },
  },
  { _id: false },
);

const questionFlagSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reporter: { type: reporterSchema, default: {} },
    reason: { type: String, enum: FLAG_REASONS, default: 'other' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: FLAG_STATUSES, default: 'open' },
    // What the admin decided and why. Kept when a decision is reopened, so the next admin reads
    // the reasoning rather than an empty box.
    resolution: { type: String, trim: true, maxlength: 500, default: '' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One report per student per question: the upsert in the service rides this index.
questionFlagSchema.index({ question: 1, student: 1 }, { unique: true });
// The admin queue, filtered by status, newest first.
questionFlagSchema.index({ status: 1, createdAt: -1 });
// Report counts per question, which is the strongest signal the queue has.
questionFlagSchema.index({ question: 1, createdAt: -1 });

questionFlagSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const QuestionFlag = mongoose.model('QuestionFlag', questionFlagSchema);
