import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    channel: { type: String, enum: ['all', 'push', 'email'], default: 'all' },
    target: { type: String, enum: ['all', 'students', 'plus', 'admins'], default: 'all' },
    linkUrl: { type: String, trim: true, default: null },
    stats: {
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
      emailSent: { type: Number, default: 0 },
      emailFailed: { type: Number, default: 0 },
      totalRecipients: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

announcementSchema.index({ createdAt: -1 });

announcementSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Announcement = mongoose.model('Announcement', announcementSchema);
