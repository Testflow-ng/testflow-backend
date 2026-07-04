import mongoose from 'mongoose';

/**
 * Record of administrative actions for accountability and continuity.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
      type: String,
      required: true,
      enum: [
        'CREATE_ADMIN',
        'UPDATE_SUBJECT',
        'DELETE_QUESTION',
        'RESET_PASSWORD',
        'TOGGLE_USER_STATUS',
        'BULK_IMPORT',
        'EXPORT_RESULTS'
      ]
    },
    targetId: { type: mongoose.Schema.Types.ObjectId }, // ID of the user/subject/question affected
    targetType: { type: String, enum: ['User', 'Subject', 'Question'] },
    metadata: { type: mongoose.Schema.Types.Mixed }, // Any additional info (e.g. subject code)
    ip: { type: String },
    userAgent: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
