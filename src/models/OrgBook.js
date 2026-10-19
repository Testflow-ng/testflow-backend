import mongoose from 'mongoose';

export const ORG_BOOK_VISIBILITIES = Object.freeze(['all_students', 'group', 'paid']);
/** Cover colours the console's `Book` component knows. */
export const ORG_BOOK_COLORS = Object.freeze(['red', 'blue', 'ink', 'green', 'amber', 'violet', 'teal']);

/**
 * A book in an organisation's own Library.
 *
 * Mirrors the platform library's `Book`, but scoped to one organisation and priced by it. A price
 * of zero is free to every student; a positive price is what makes a payout account mandatory
 * before the book can be published (see `orgMoney`/`orgBook` services). `fileKey` is the object key
 * in the media store and is never serialised; a signed URL is minted on the student download path.
 */
const orgBookSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, uppercase: true, default: '' },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    color: { type: String, enum: ORG_BOOK_COLORS, default: 'ink' },
    priceMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'NGN', uppercase: true },
    visibility: { type: String, enum: ORG_BOOK_VISIBILITIES, default: 'all_students' },
    previewPages: { type: Number, default: 0, min: 0 },
    pages: { type: Number, default: 0, min: 0 },
    sizeBytes: { type: Number, default: 0, min: 0 },
    fileKey: { type: String, default: null },
    fileName: { type: String, trim: true, default: null },
    published: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgBookSchema.index({ organization: 1, createdAt: -1 });

orgBookSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgBook = mongoose.model('OrgBook', orgBookSchema);
