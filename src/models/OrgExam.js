import mongoose from 'mongoose';

/**
 * An exam an organisation builds and runs for its own students.
 *
 * The field names follow the console's settings form, not the platform CBT: `mode` (anytime or a
 * live start), `startsAt`, `access` (link, invited or a code) and `showCorrections` (what a student
 * sees after submitting). The console is the contract here; a second set of aliases would only
 * create two ways to say the same thing.
 *
 * The console creates an exam from a title and a mode before any questions exist, so the question
 * list starts empty and is filled in later. `questionCount` is derived from `questionIds`, never
 * stored separately.
 *
 * `priceMinor > 0` makes it a paid exam. Paid exams cannot go live without an active payout
 * account, which is enforced in the console service rather than here.
 */
const orgExamSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    instructions: { type: String, trim: true, default: '', maxlength: 5000 },

    mode: { type: String, enum: ['anytime', 'live'], default: 'anytime' },
    // Only meaningful in live mode: when everyone starts together.
    startsAt: { type: Date, default: null },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },

    questionIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'OrgQuestion', default: [] },

    access: { type: String, enum: ['link', 'invited', 'code'], default: 'link' },
    accessCode: { type: String, trim: true, maxlength: 20, default: '' },

    // What a student sees after submitting. `score_only` records the paper but shows only the
    // score; `hidden` records it for the owner alone.
    showCorrections: { type: String, enum: ['now', 'after_exam', 'score_only', 'hidden'], default: 'now' },

    shuffleQuestions: { type: Boolean, default: true },
    shuffleOptions: { type: Boolean, default: false },
    marksPerQuestion: { type: Number, default: 1, min: 0 },
    negativeMarking: { type: Number, default: 0, min: 0 },
    attemptsAllowed: { type: Number, default: 1, min: 1 },

    priceMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'NGN', uppercase: true },

    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgExamSchema.index({ organization: 1, status: 1, startsAt: 1 });
orgExamSchema.index({ organization: 1, title: 1 });

orgExamSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgExam = mongoose.model('OrgExam', orgExamSchema);
