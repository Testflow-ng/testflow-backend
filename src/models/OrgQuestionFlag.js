import mongoose from 'mongoose';

export const ORG_FLAG_REASONS = Object.freeze(['wrong_answer', 'unclear', 'typo', 'other']);
export const ORG_FLAG_STATUSES = Object.freeze(['open', 'resolved', 'dismissed']);

/**
 * A student's report that one of an organisation's *org questions* looks wrong.
 *
 * The same idea as `QuestionFlag`, scaled down and scoped to the organisation that owns the
 * question: one row per student per question, so a report count is a count of students rather than
 * a count of taps. `reportCount` on the console list is derived from these rows, not stored.
 *
 * `reporter` freezes the student's name as it was when they reported, so a later profile edit does
 * not rewrite what the owner was shown.
 */
const reporterSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, maxlength: 120 },
    email: { type: String, trim: true, maxlength: 254 },
  },
  { _id: false },
);

const orgQuestionFlagSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgQuestion', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reporter: { type: reporterSchema, default: {} },
    reason: { type: String, enum: ORG_FLAG_REASONS, default: 'other' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ORG_FLAG_STATUSES, default: 'open' },
    // The exam the student was sitting, when they reported it from one. Empty otherwise.
    examTitle: { type: String, trim: true, maxlength: 200, default: '' },
    resolution: { type: String, trim: true, maxlength: 500, default: '' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orgQuestionFlagSchema.index({ question: 1, student: 1 }, { unique: true });
orgQuestionFlagSchema.index({ organization: 1, status: 1, createdAt: -1 });
orgQuestionFlagSchema.index({ organization: 1, question: 1, createdAt: -1 });

orgQuestionFlagSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgQuestionFlag = mongoose.model('OrgQuestionFlag', orgQuestionFlagSchema);
