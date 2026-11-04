import mongoose from 'mongoose';

const deviceTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, trim: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
    deviceName: { type: String, trim: true, default: null },
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ user: 1, active: 1 });

deviceTokenSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
