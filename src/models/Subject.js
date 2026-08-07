import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 500 },
    level: { type: String, enum: ['post-utme', '100', '200', '300', '400', '500'], index: true },
    department: { type: String, trim: true, index: true },
    isGeneral: { type: Boolean, default: false, index: true },
    isCompulsoryUtme: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

subjectSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const Subject = mongoose.model('Subject', subjectSchema);
