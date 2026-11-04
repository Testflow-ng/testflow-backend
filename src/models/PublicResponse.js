import mongoose from 'mongoose';

const publicResponseSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
      index: true,
    },
    selectedOption: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    metadata: {
      ip: String,
      userAgent: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index for analytics: breakdown of choices per question
publicResponseSchema.index({ question: 1, selectedOption: 1 });
// Index for analytics: accuracy per question
publicResponseSchema.index({ question: 1, isCorrect: 1 });

export const PublicResponse = mongoose.model('PublicResponse', publicResponseSchema);
