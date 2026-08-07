import mongoose from 'mongoose';

const verificationRequestSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiptImage: { type: String, required: true },
    receiptHash: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },
    transactionRef: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

verificationRequestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  },
});

export const VerificationRequest = mongoose.model('VerificationRequest', verificationRequestSchema);
