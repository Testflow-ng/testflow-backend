import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
      index: true,
    },
    stem: { type: String, required: true, trim: true, maxlength: 2000 },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) =>
          Array.isArray(arr) &&
          arr.length >= 2 &&
          arr.length <= 6 &&
          arr.every((option) => typeof option === 'string' && option.trim().length > 0) &&
          new Set(arr.map((option) => option.trim())).size === arr.length,
        message: 'A question must have 2 to 6 distinct, non-empty options.',
      },
    },
    correctIndex: { type: Number, required: true, min: 0 },
    explanation: { type: String, trim: true, maxlength: 2000 },
    topic: { type: String, trim: true, maxlength: 100 },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Cross-field guard: the correct answer must point at an existing option.
questionSchema.pre('validate', function validateCorrectIndex(next) {
  if (Array.isArray(this.options) && this.correctIndex >= this.options.length) {
    this.invalidate('correctIndex', 'correctIndex must reference a valid option.');
  }
  next();
});

questionSchema.index({ subject: 1, isActive: 1 });
// Backs the admin list query (filter by subject, sort by newest).
questionSchema.index({ subject: 1, createdAt: -1 });

// NOTE: this transform intentionally keeps correctIndex/explanation — question
// routes are admin-only. The exam engine (Phase 4) must project those out when
// serving questions to students.
questionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const Question = mongoose.model('Question', questionSchema);
