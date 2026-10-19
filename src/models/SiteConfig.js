import mongoose from 'mongoose';

export const SITE_TEMPLATES = Object.freeze(['classic', 'modern', 'minimal']);

/** The pages an owner can switch on or off. Order matches the console's list. */
export const SITE_PAGES = Object.freeze([
  'exams', 'results', 'library', 'community', 'leaderboard', 'about', 'contact',
]);

/** A brand-new site starts with everything on except Community. */
export const DEFAULT_SITE_PAGES = Object.freeze({
  exams: true, results: true, library: true, community: false,
  leaderboard: true, about: true, contact: true,
});

/**
 * The words, pictures and switches of one organisation's site.
 *
 * Two surfaces (the public landing page and the student portal) each carry their own block list,
 * so the shape is stored as data rather than as a fixed set of columns. `draft` is what the owner
 * is editing; `published` is what visitors see. Publishing copies the draft across wholesale, so a
 * half-finished edit can never leak. The exact block schema is checked in the validator, not here,
 * which is why both halves are `Mixed`: a new block type must not need a model migration.
 */
const siteConfigSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    template: { type: String, enum: SITE_TEMPLATES, default: 'modern' },
    draft: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    published: { type: mongoose.Schema.Types.Mixed, default: null },
    draftVersion: { type: Number, default: 0 },
    publishedVersion: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

siteConfigSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);
