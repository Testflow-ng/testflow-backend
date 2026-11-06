import { AuditLog } from '../models/AuditLog.js';

/**
 * Record an administrative action in the audit log.
 */
import mongoose from 'mongoose';

const normalizeActor = (actorId) => {
  if (actorId == null || actorId === '') return undefined;
  if (actorId === 'system' || actorId === 'SYSTEM') return undefined;
  if (typeof actorId === 'string' && mongoose.isValidObjectId(actorId)) return actorId;
  if (actorId instanceof mongoose.Types.ObjectId) return actorId;
  // Preserve unknown non-ObjectId actors as metadata context rather than causing cast validation.
  return undefined;
};

export const recordAction = async ({ actorId, action, targetId, targetType, metadata, req }) => {
  try {
    const actor = normalizeActor(actorId);
    const systemMeta =
      actorId === 'system' || actorId === 'SYSTEM'
        ? { ...(metadata && typeof metadata === 'object' ? metadata : {}), actor: 'system' }
        : metadata;
    await AuditLog.create({
      ...(actor ? { actor } : {}),
      action,
      targetId,
      targetType,
      metadata: systemMeta,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent']
    });
  } catch (error) {
    // Audit logging should not crash the main request, but log enough context to diagnose.
    console.error('Audit Log Error:', error?.name || 'Error', error?.message || String(error));
  }
};
