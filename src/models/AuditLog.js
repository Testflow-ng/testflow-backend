import mongoose from 'mongoose';

/**
 * Record of administrative actions for accountability and continuity.
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Null actor = system job (e.g. scheduled retention purge).
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
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
        'EXPORT_RESULTS',
        'SUBMIT_VERIFICATION',
        'APPROVE_VERIFICATION',
        'REJECT_VERIFICATION',
        'BULK_DELETE_QUESTIONS',
        'BULK_TOGGLE_QUESTIONS',
        'CREATE_SUBJECT',
        'DELETE_SUBJECT',
        'AD_APPROVE',
        'AD_REJECT',
        'AD_SUSPEND',
        'AD_REINSTATE',
        'AD_REMOVE',
        'AD_SETTINGS_UPDATE',
        'AD_PAYMENT_VERIFIED',
        'AD_PAYMENT_REFUND',
        'AD_TRAINING_EXPORT',
        'AUTH_REGISTER',
        'AUTH_LOGIN',
        'AUTH_LOGIN_FAILED',
        'AUTH_LOGOUT',
        'MEMBERSHIP_ADD',
        'PRODUCT_SWITCH',
        'PASSWORD_RESET_REQUEST',
        'PASSWORD_RESET',
        'PASSWORD_CHANGE',
        'OAUTH_CODE_ISSUED',
        'OAUTH_TOKEN_ISSUED',
        'AD_CAMPAIGN_PURGED',
        'ORG_CREATE',
        'ORG_UPDATE',
        'ORG_MEMBER_ADD',
        'ORG_MEMBER_UPDATE',
        'ORG_MEMBER_REMOVE',
        'ORG_INVITE',
        'ORG_SUSPEND',
        'ORG_REINSTATE',
        'PLAN_EDIT',
        'SITE_EDIT',
        'SITE_PUBLISH',
        'SUBSCRIPTION_CREATE',
        'SUBSCRIPTION_EXPIRE',
        'SUBSCRIPTION_LIFECYCLE',
        'SUBSCRIPTION_CLEANUP',
        'SUBSCRIPTION_PAYMENT_VERIFIED',
        'AD_FREE_PURCHASE_VERIFIED',
        'AD_FREE_REFUND',
        'ENTITLEMENT_GRANT',
        'ENTITLEMENT_REVOKE',
        'CREATE_STUDENT',
        'PROMOTE_ADMIN',
        'DEMOTE_ADMIN',
        'DELETE_USER',
        'UPDATE_SETTINGS',
        'VERIFY_POST_UTME',
        'REVIEW_FEEDBACK',
        'REVIEW_QUESTION_FLAG'
      ]
    },
    targetId: { type: mongoose.Schema.Types.ObjectId }, // ID of the user/subject/question affected
    targetType: { type: String, enum: ['User', 'Subject', 'Question', 'Campaign', 'AdSettings', 'AdPayment', 'Organization', 'Feedback', 'QuestionFlag', 'StudentPurchase', 'StudentEntitlement'] },
    metadata: { type: mongoose.Schema.Types.Mixed }, // Any additional info (e.g. subject code)
    ip: { type: String },
    userAgent: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
