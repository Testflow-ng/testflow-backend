import mongoose from 'mongoose';

export const ORG_QUESTION_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

/**
 * A question owned by an organisation: the console's own bank, separate from Testflow's.
 *
 * An option is text, an image, or both, so each option is a small object rather than a string.
 * `correctIndex` points into that array. Images live in the media store; only their public URLs are
 * stored here, and the upload endpoint writes the asset row that scopes them to this organisation.
 */
const optionSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const orgQuestionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // The bank it lives in, when it lives in one. Null is the loose pile a question sits in until
    // the owner files it.
    bank: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgQuestionBank', default: null, index: true },
    stem: { type: String, required: true, trim: true },
    stemImageUrl: { type: String, trim: true, default: null },
    options: {
      type: [optionSchema],
      default: [],
      validate: [(arr) => arr.length >= 2 && arr.length <= 6, 'An option list has between 2 and 6 choices.'],
    },
    correctIndex: { type: Number, required: true, min: 0 },
    topic: { type: String, trim: true, default: '' },
    difficulty: { type: String, enum: ORG_QUESTION_DIFFICULTIES, default: 'medium' },
    explanation: { type: String, trim: true, default: '' },
    explanationImageUrl: { type: String, trim: true, default: null },
    // A question used by a published exam that has already been sat is never hard-deleted: the
    // attempts keep their snapshot, and this flag hides it from the bank and from new sittings.
    softDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgQuestionSchema.index({ organization: 1, createdAt: -1 });

orgQuestionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgQuestion = mongoose.model('OrgQuestion', orgQuestionSchema);
