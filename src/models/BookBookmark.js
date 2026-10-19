import mongoose from 'mongoose';

/**
 * A Library book a student saved to come back to.
 *
 * Separate from `QuestionBookmark`: different resource (a book, not a question), different screen
 * and different lifecycle. Like a question bookmark it is a toggle, so the unique index is what
 * keeps two racing taps from leaving two rows.
 */
const bookBookmarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  },
  { timestamps: true },
);

bookBookmarkSchema.index({ user: 1, book: 1 }, { unique: true });
// The bookmarked filter and the newest-first habit.
bookBookmarkSchema.index({ user: 1, createdAt: -1 });

bookBookmarkSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const BookBookmark = mongoose.model('BookBookmark', bookBookmarkSchema);
