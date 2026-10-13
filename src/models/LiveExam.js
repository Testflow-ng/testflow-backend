import mongoose from 'mongoose';

const liveExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shareCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'waiting', 'ready', 'in_progress', 'completed', 'results_published', 'cancelled'],
      default: 'waiting',
      index: true,
    },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    // Explicit question selection (alternative to subject-bank sampling).
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    numQuestions: { type: Number, required: true, min: 1, max: 200 },
    durationMinutes: { type: Number, required: true, min: 1, max: 240 },
    maxParticipants: { type: Number, min: 1, max: 30 },
    difficulty: { type: String, enum: ['mixed', 'easy', 'medium', 'hard'], default: 'mixed' },
    shuffleQuestions: { type: Boolean, default: true },
    shuffleOptions: { type: Boolean, default: true },
    negativeMarking: { type: Number, default: 0, min: 0, max: 5 },
    marksPerQuestion: { type: Number, default: 1, min: 0.5, max: 100 },
    allowReview: { type: Boolean, default: true },
    // Authoritative timing — the backend is the source of truth, never the client clock.
    startedAt: { type: Date },
    endsAt: { type: Date },
    // Monotonic counter for the deterministic final ranking tie-breaker.
    nextSequence: { type: Number, default: 1 },
    totalPossible: { type: Number },
    resultsComputedAt: { type: Date },
    resultsPublishedAt: { type: Date },
  },
  { timestamps: true },
);

liveExamSchema.index({ host: 1, createdAt: -1 });

liveExamSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const LiveExam = mongoose.model('LiveExam', liveExamSchema);
