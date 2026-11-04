import mongoose from 'mongoose';

/**
 * Where a student stopped in one book.
 *
 * One row per (student, book), so "Continue reading" can resume every book they opened
 * independently rather than only the last one. `percent` is stored because the client reads it
 * literally, but it is always recomputed from the book's own page count on write: a client
 * percentage is never trusted.
 */
const bookReadingProgressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    page: { type: Number, required: true, min: 1 },
    percent: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true },
);

bookReadingProgressSchema.index({ user: 1, book: 1 }, { unique: true });
// "Continue reading" is every row for one student, newest activity first.
bookReadingProgressSchema.index({ user: 1, updatedAt: -1 });

bookReadingProgressSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const BookReadingProgress = mongoose.model('BookReadingProgress', bookReadingProgressSchema);
