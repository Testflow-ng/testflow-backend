import mongoose from 'mongoose';

export const ORG_ATTEMPT_STATUSES = Object.freeze(['in_progress', 'submitted', 'timed_out']);

const optionSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: null },
  },
  { _id: false },
);

/**
 * The paper as it was handed to this student.
 *
 * An organisation may edit a question after an exam has run. Every attempt keeps its own copy, so
 * an old score and its corrections can never be rewritten by a later edit to the bank.
 */
const snapshotQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgQuestion', required: true },
    stem: { type: String, required: true },
    stemImageUrl: { type: String, trim: true, default: null },
    options: { type: [optionSchema], default: [] },
    correctIndex: { type: Number, required: true },
    explanation: { type: String, default: '' },
    explanationImageUrl: { type: String, trim: true, default: null },
    topic: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgQuestion', required: true },
    selectedIndex: { type: Number, default: null },
    correct: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * One student sitting one organisation exam.
 *
 * `endsAt` is set from the server clock at start. A live exam ends at `startsAt + duration` for
 * everyone, so a late joiner gets only the time that is left. The paper is marked once, on submit
 * or when the clock runs out, and the score fields are frozen from then on.
 */
const orgAttemptSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgExam', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    examTitle: { type: String, trim: true, default: '' },
    attemptNumber: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ORG_ATTEMPT_STATUSES, default: 'in_progress' },
    questions: { type: [snapshotQuestionSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    correctCount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    // Copied from the exam at start, so a later rules edit cannot rescore this paper.
    marksPerQuestion: { type: Number, default: 1, min: 0 },
    negativeMarking: { type: Number, default: 0, min: 0 },
    scorePercent: { type: Number, default: null },
    timeMinutes: { type: Number, default: null },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orgAttemptSchema.index({ organization: 1, exam: 1, status: 1 });
orgAttemptSchema.index({ organization: 1, student: 1, submittedAt: -1 });
orgAttemptSchema.index({ exam: 1, student: 1, attemptNumber: 1 }, { unique: true });

orgAttemptSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgAttempt = mongoose.model('OrgAttempt', orgAttemptSchema);
