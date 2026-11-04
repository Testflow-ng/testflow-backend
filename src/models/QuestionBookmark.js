import mongoose from 'mongoose';

/**
 * A question a student saved to study later.
 *
 * Not the exam's own "mark for review" (private to a sitting, cleared with the paper), and not
 * the library's book bookmark: different resource, different screen. This one outlives the
 * attempt it came from and is read back from the profile with its answer and explanation.
 */
const questionBookmarkSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Saving is a toggle: two taps racing must leave one row, not two.
questionBookmarkSchema.index({ question: 1, student: 1 }, { unique: true });
// The student's own list, newest first.
questionBookmarkSchema.index({ student: 1, createdAt: -1 });

questionBookmarkSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const QuestionBookmark = mongoose.model('QuestionBookmark', questionBookmarkSchema);
