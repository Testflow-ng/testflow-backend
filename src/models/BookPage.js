import mongoose from 'mongoose';

/** The block kinds the reader switches on. A type it does not know is ignored, not an error. */
export const BOOK_BLOCK_TYPES = Object.freeze(['heading', 'paragraph']);

/**
 * One page of readable content, deliberately simple: a short list of headings and paragraphs.
 *
 * A page is its own document so the reader pulls one page at a time and the client never receives
 * a whole book. A book with no row for a page answers with no blocks, which the reader renders as
 * "not published yet" rather than as a missing book.
 */
const blockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: BOOK_BLOCK_TYPES, required: true },
    text: { type: String, required: true },
  },
  { _id: false },
);

const bookPageSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    page: { type: Number, required: true, min: 1 },
    blocks: { type: [blockSchema], default: [] },
  },
  { timestamps: true },
);

// One document per page; re-importing a book updates a page in place.
bookPageSchema.index({ book: 1, page: 1 }, { unique: true });

bookPageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const BookPage = mongoose.model('BookPage', bookPageSchema);
