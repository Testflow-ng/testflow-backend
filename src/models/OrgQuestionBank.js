import mongoose from 'mongoose';

/**
 * A folder of an organisation's questions: "JAMB Mathematics", "Physics", and so on.
 *
 * A bank is a convenience, not a container that owns its questions: a question points at one bank
 * (`OrgQuestion.bank`), and an exam copies the ids it uses into its own `questionIds`. Deleting a
 * bank therefore removes the questions in it in one move, which is what the console warns about.
 */
const orgQuestionBankSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: '', maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgQuestionBankSchema.index({ organization: 1, createdAt: -1 });

orgQuestionBankSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgQuestionBank = mongoose.model('OrgQuestionBank', orgQuestionBankSchema);
