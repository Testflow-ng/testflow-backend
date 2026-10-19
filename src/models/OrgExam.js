import mongoose from 'mongoose';

const orgExamSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    instructions: { type: String, trim: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    questionIds: { type: [mongoose.Schema.Types.ObjectId], required: true, validate: [function(arr) { return arr.length > 0; }, 'At least one question required'] },
    numQuestions: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    availableFrom: { type: Date, required: true },
    availableUntil: { type: Date, required: true },
    access: { type: String, enum: ['enrolled', 'assigned', 'code'], default: 'enrolled' },
    accessCode: { type: String, trim: true, maxlength: 20 },
    attemptsAllowed: { type: Number, default: 1 },
    shuffleQuestions: { type: Boolean, default: true },
    shuffleOptions: { type: Boolean, default: false },
    marksPerQuestion: { type: Number, default: 1 },
    negativeMarking: { type: Boolean, default: false },
    resultsVisibility: { type: String, enum: ['immediate', 'after_window', 'manual'], default: 'immediate' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgExamSchema.index({ organization: 1, status: 1, availableFrom: 1 });
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