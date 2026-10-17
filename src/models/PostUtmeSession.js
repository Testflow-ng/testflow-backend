import mongoose from 'mongoose';

const postUtmeQuestionSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    subjectCode: { type: String, required: true },
    stem: { type: String, required: true },
    options: { type: [String], required: true },
    correctOption: { type: Number, required: true },
    explanation: { type: String },
    // Snapshotted for the report's topic breakdown, same as the single-subject paper.
    topic: { type: String, trim: true, maxlength: 160 },
    selectedOption: { type: Number, default: null },
    markedForReview: { type: Boolean, default: false },
  },
  { _id: false },
);

const postUtmeSessionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Post-UTME usually involves 4 subjects (including Use of English)
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true }],
    subjectCodes: [String],
    status: {
      type: String,
      enum: ['in_progress', 'submitted'],
      default: 'in_progress',
    },
    durationMinutes: { type: Number, default: 60 },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date },
    timeTakenSeconds: { type: Number },
    questions: [postUtmeQuestionSchema],
    totalQuestions: { type: Number, default: 40 }, // Usually 10 per subject
    scores: {
      type: Map,
      of: Number
    },
    totalScore: { type: Number },
    strikes: { type: Number, default: 0 },
    navigationHistory: [{
      fromSubject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
      toSubject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
      timestamp: { type: Date, default: Date.now }
    }],
    metadata: {
      jambScore: Number,
      oLevelPoints: Number,
      departmentChoice: String
    }
  },
  { timestamps: true },
);

// One active Post-UTME session at a time per student.
//
// Named explicitly: the `student` field already carries a plain index (history and stats
// queries filter on status, which a *partial* index cannot serve), and both would otherwise be
// auto-named `student_1`. Mongoose then silently keeps one of them, which is how this guard
// was never actually enforced in a database that had already built the plain index first.
postUtmeSessionSchema.index(
  { student: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'in_progress' },
    name: 'one_active_putme_per_student',
  },
);

postUtmeSessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    if (Array.isArray(ret.questions)) {
      ret.questions.forEach((q) => {
        delete q.correctOption;
        delete q.explanation;
      });
    }
    return ret;
  },
});

export const PostUtmeSession = mongoose.model('PostUtmeSession', postUtmeSessionSchema);
