import mongoose from 'mongoose';

const liveQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    stem: { type: String, required: true },
    options: { type: [String], required: true },
    correctOption: { type: Number, required: true },
    explanation: { type: String },
    selectedOption: { type: Number, default: null },
  },
  { _id: false },
);

const liveParticipantSchema = new mongoose.Schema(
  {
    liveExam: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveExam', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'removed'],
      default: 'pending',
      index: true,
    },
    // Deterministic final ranking tie-breaker, assigned atomically at approval.
    sequenceNumber: { type: Number },
    approvedAt: { type: Date },
    questions: { type: [liveQuestionSchema], default: [] },
    attemptStatus: {
      type: String,
      enum: ['waiting', 'in_progress', 'submitted', 'timed_out'],
      default: 'waiting',
    },
    submittedAt: { type: Date },
    timeTakenSeconds: { type: Number },
    score: { type: Number },
    correctCount: { type: Number },
    incorrectCount: { type: Number },
    unansweredCount: { type: Number },
    accuracy: { type: Number },
    rank: { type: Number },
  },
  { timestamps: true },
);

// One registration per user per exam — prevents duplicate registrations.
liveParticipantSchema.index({ liveExam: 1, user: 1 }, { unique: true });
liveParticipantSchema.index({ liveExam: 1, status: 1 });
liveParticipantSchema.index({ liveExam: 1, rank: 1 });

// Defense in depth: strip the answer key whenever a participant doc is serialized.
liveParticipantSchema.set('toJSON', {
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

export const LiveParticipant = mongoose.model('LiveParticipant', liveParticipantSchema);
