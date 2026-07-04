import { AuditLog } from '../models/AuditLog.js';

/**
 * Record an administrative action in the audit log.
 */
export const recordAction = async ({ actorId, action, targetId, targetType, metadata, req }) => {
  try {
    await AuditLog.create({
      actor: actorId,
      action,
      targetId,
      targetType,
      metadata,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent']
    });
  } catch (error) {
    // Audit logging should not crash the main request
    console.error('Audit Log Error:', error);
  }
};
