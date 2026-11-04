import mongoose from 'mongoose';

/** Cover colours the client knows. A value it does not know falls back to `ink`. */
export const BOOK_COLORS = Object.freeze(['red', 'blue', 'ink', 'green', 'amber', 'violet', 'teal']);
export const BOOK_SEMESTERS = Object.freeze(['first', 'second']);
export const BOOK_LEVELS = Object.freeze([100, 200, 300, 400, 500]);

/**
 * A past-question book or study material on the Library shelf.
 *
 * Metadata only. The shelf is browsed by code, title, author, topic, level and semester, so the
 * list never needs to touch the content. The file itself lives in R2 behind `fileKey`, which is
 * never serialized into an API response (the download route signs a short-lived URL for it), and
 * the readable text lives in `BookPage`, one page at a time.
 *
 * `published: false` is how a book that is still being prepared stays off the shelf: every read
 * filters on it, so a half-written book cannot leak through the list, the reader or a download
 * link someone bookmarked.
 */
const bookSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true }, // e.g. MTH101
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    color: { type: String, enum: BOOK_COLORS, default: 'ink' },
    level: { type: Number, enum: BOOK_LEVELS, required: true, index: true },
    semester: { type: String, enum: BOOK_SEMESTERS, required: true },
    pages: { type: Number, required: true, min: 1 },
    /** The real file size, reported by the download endpoint. `sizeKb` is derived from it. */
    sizeBytes: { type: Number, default: 0, min: 0 },
    edition: { type: String, default: '', trim: true },
    author: { type: String, default: 'TestFlow Editorial', trim: true },
    year: { type: Number, default: null },
    topics: { type: [String], default: [] },
    /** R2 key of the downloadable file. Null until the file is uploaded: download answers 403. */
    fileKey: { type: String, default: null },
    published: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The shelf's own filters, in the order the list applies them.
bookSchema.index({ published: 1, level: 1, semester: 1 });
// Case-insensitive search runs over these fields; a course code or a title is the common entry.
bookSchema.index({ title: 1 });

bookSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Book = mongoose.model('Book', bookSchema);
