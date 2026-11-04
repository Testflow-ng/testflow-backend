import mongoose from 'mongoose';

export const ORG_POST_TYPES = Object.freeze(['announcement', 'discussion']);

/**
 * A short notice an organisation posts for its own students, and the console's Announcements
 * screen. `pinned` floats one to the top of the student home page; `hidden` keeps it for the
 * owner without deleting it.
 */
const orgPostSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: ORG_POST_TYPES, default: 'announcement' },
    text: { type: String, required: true, trim: true, maxlength: 5000 },
    pinned: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgPostSchema.index({ organization: 1, pinned: -1, createdAt: -1 });

orgPostSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgPost = mongoose.model('OrgPost', orgPostSchema);
