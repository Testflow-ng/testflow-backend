import mongoose from 'mongoose';

/**
 * Feedback about TestFlow itself, sent by a student from Settings.
 *
 * Deliberately a separate collection from a *question* report, even though the two rows look
 * alike: a report is about a broken question and is worked by whoever owns the question bank,
 * while this is about the product and is worked by whoever owns the screen it names. Merging
 * them would mean one queue with two different jobs in it.
 *
 * `reply` is what the student reads back, so it is never a place for an internal note. It can
 * be emptied: a note written by mistake should be removable, not overwritten with an apology.
 *
 * `resolvedBy`/`resolvedAt` are kept for the audit trail even though no screen shows them yet.
 * "Who told this student it was fixed" is the first question when it turns out not to be.
 */
const feedbackSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['problem', 'idea', 'other'], default: 'other', index: true },
    // Optional on purpose: a bug report must never be gated on rating the product.
    rating: { type: Number, min: 1, max: 5, default: null },
    // Free text, not a route: students describe places that do not map to our URLs
    // ("the exam timer", "when I rotate my phone").
    screen: { type: String, trim: true, maxlength: 80, default: null },
    message: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    // Whitespace-and-case-normalised message. Not unique: after a day the same words are a
    // new report, and the check is deliberately best-effort rather than a hard constraint.
    messageHash: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_review', 'resolved'], default: 'open' },
    reply: { type: String, trim: true, maxlength: 500, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// The admin queue: filtered by status, newest first.
feedbackSchema.index({ status: 1, createdAt: -1 });
// A student's own list.
feedbackSchema.index({ student: 1, createdAt: -1 });
// Collapsing a stuck client's retries into one row.
feedbackSchema.index({ student: 1, messageHash: 1, createdAt: -1 });

feedbackSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    // Internal bookkeeping: nothing outside the service has a use for it.
    delete ret.messageHash;
    return ret;
  },
});

export const Feedback = mongoose.model('Feedback', feedbackSchema);
