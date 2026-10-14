import { AppError } from '../AppError.js';

/**
 * Explicit campaign state machine. Every status change in the codebase goes
 * through `assertTransition` and is written with an atomic, status-guarded
 * update (see campaign.service `transition`), so concurrent requests cannot
 * produce an invalid or double transition.
 *
 *   draft ──checkout──▶ pending_payment ──payment verified──▶ pending_review
 *   pending_review ──approve──▶ scheduled | active      (start date decides)
 *   pending_review ──reject──▶ rejected ──edit+resubmit (already paid)──▶ pending_review
 *   scheduled ──startsAt reached──▶ active ──endsAt reached──▶ expired
 *   active|scheduled ──admin──▶ suspended ──reinstate──▶ active|scheduled
 *   active|scheduled|suspended ──admin──▶ removed
 *   expired|removed|rejected ──advertiser──▶ archived (hidden, still purged on schedule)
 */
export const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_PAYMENT: 'pending_payment',
  PENDING_REVIEW: 'pending_review',
  REJECTED: 'rejected',
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  EXPIRED: 'expired',
  REMOVED: 'removed',
  CANCELLED: 'cancelled',
  ARCHIVED: 'archived',
});

export const ALL_STATUSES = Object.values(STATUS);

const T = STATUS;
export const TRANSITIONS = Object.freeze({
  [T.DRAFT]: [T.PENDING_PAYMENT, T.CANCELLED],
  [T.PENDING_PAYMENT]: [T.PENDING_REVIEW, T.DRAFT, T.CANCELLED],
  [T.PENDING_REVIEW]: [T.SCHEDULED, T.ACTIVE, T.REJECTED],
  [T.REJECTED]: [T.PENDING_REVIEW, T.ARCHIVED],
  [T.SCHEDULED]: [T.ACTIVE, T.SUSPENDED, T.REMOVED, T.EXPIRED],
  [T.ACTIVE]: [T.EXPIRED, T.SUSPENDED, T.REMOVED],
  [T.SUSPENDED]: [T.ACTIVE, T.SCHEDULED, T.REMOVED, T.EXPIRED],
  [T.EXPIRED]: [T.ARCHIVED],
  [T.REMOVED]: [T.ARCHIVED],
  [T.CANCELLED]: [],
  [T.ARCHIVED]: [],
});

/** Statuses where an advertiser may still edit content. */
export const EDITABLE = Object.freeze([T.DRAFT, T.REJECTED]);
/** Statuses that count as "live" for serving/ownership of an image etc. */
export const SERVABLE = Object.freeze([T.ACTIVE, T.SCHEDULED]);

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

export const assertTransition = (from, to) => {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A campaign in "${from}" cannot move to "${to}".`);
  }
};
