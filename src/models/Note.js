import mongoose from 'mongoose';

/**
 * A student-generated class note.
 *
 * Unlike lecturer-provided `Book` PDFs, notes are crowd-sourced from students.
 * They are typically images (scanned handwriting) or short text summaries.
 * Notes can be tagged by subject and made visible to all students in that course.
 */

const noteSchema = new mongoose.Schema(
  {
    /** Link to the Subject this note covers */
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    /** Title given by the uploader, e.g. "Week 3 — Limits" */
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    /** Free-form description / tags, e.g. "chapter 3, limits at infinity" */
    description: {
      type: String,
      default: '',
      trim: true,
    },
    /** R2 key for the note image (scanned handwritten page, whiteboard photo, etc.) */
    imageKey: {
      type: String,
      default: null,
    },
    /** Optional PDF if the note was typed up */
    pdfKey: {
      type: String,
      default: null,
    },
    /** Who uploaded this note */
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    /** Visibility: all students or paid only */
    visibility: {
      type: String,
      enum: ['all_students', 'paid'],
      default: 'all_students',
    },
    /** Book type: always 'slides' for notes, but we keep the field for consistency */
    bookType: {
      type: String,
      enum: ['slides', 'textbook'],
      default: 'slides',
    },
    /** Timestamps */
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes for fast subject + visibility lookups
noteSchema.index({ subject: 1, visibility: 1 });
noteSchema.index({ subject: 1, createdAt: -1 });

export const Note = mongoose.model('Note', noteSchema);
