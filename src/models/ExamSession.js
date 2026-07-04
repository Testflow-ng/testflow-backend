import mongoose from 'mongoose';

/**
 * A per-question snapshot taken at session start. `options` is already shuffled
 * for this attempt; `correctOption` is the index of the right answer WITHIN that
 * shuffled array. `correctOption` and `explanation` are answer-key data and must
 * never reach the student before submission (see the service projections and the
 * defensive toJSON transform below).
 */
const sessionQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    stem: { type: String, required: true },
    options: { type: [String], required: true },
    correctOption: { type: Number, required: true },
    explanation: { type: String },
    selectedOption: { type: Number, default: null },
    markedForReview: { type: Boolean, default: false },
  },
  { _id: false },
);

const examSessionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    subjectCode: { type: String, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'submitted'],
      default: 'in_progress',
    },
    durationMinutes: { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date },
    questions: { type: [sessionQuestionSchema], required: true },
    totalQuestions: { type: Number, required: true },
    correctCount: { type: Number },
    score: { type: Number },
    strikes: { type: Number, default: 0 }, // For focus detection (anti-cheating)
  },
  { timestamps: true },
);

// At most one in-progress session per student+subject (enforces the resume
// invariant even under a start race).
examSessionSchema.index(
  { student: 1, subject: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' } },
);
examSessionSchema.index({ student: 1, createdAt: -1 });

// Defense in depth: even if a raw session is ever serialized, strip the answer key.
examSessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    if (Array.isArray(ret.questions)) {
      ret.questions.forEach((question) => {
        delete question.correctOption;
        delete question.explanation;
      });
    }
    return ret;
  },
});

export const ExamSession = mongoose.model('ExamSession', examSessionSchema);
