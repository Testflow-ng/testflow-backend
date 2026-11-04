import { OrgMembership } from '../models/OrgMembership.js';
import { User } from '../models/User.js';
import { DeviceToken } from '../models/DeviceToken.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { sendPushToTokens } from './fcm.service.js';
import { sendOrgAnnouncementEmail, sendOrgInvitationEmail } from './email.service.js';

/**
 * Email and push for an Everybody organisation.
 *
 * It rides the same Resend and Firebase setup as the student app, so a student's registered
 * devices and notification preferences are reused. What changes is the face: the push title and
 * the email sender are the organisation's name, never "Testflow".
 *
 * Every send here is best effort. A failed notification must never fail the action that caused it
 * (publishing an exam, posting an announcement), so callers fire these without awaiting the result.
 */

const MAX_RECIPIENTS = 2000;
const PUSH_PREF = 'announcement';

/** The address a student opens: the organisation's own subdomain. */
export const orgSiteUrl = (org) =>
  config.NODE_ENV === 'production' ? `https://${org.slug}.testflow.com.ng` : config.CLIENT_URL;

const activeStudentIds = async (orgId) => {
  const rows = await OrgMembership.find({ organization: orgId, role: 'student', status: 'active' })
    .select('user')
    .limit(MAX_RECIPIENTS)
    .lean();
  return rows.map((r) => r.user);
};

/** Push to every active student of the organisation who has not switched announcements off. */
export const pushToOrgStudents = async (org, { title, body, url }) => {
  try {
    const ids = await activeStudentIds(org._id);
    if (!ids.length) return { sent: 0 };
    const users = await User.find({ _id: { $in: ids }, [`notificationPreferences.${PUSH_PREF}`]: { $ne: false } })
      .select('_id')
      .lean();
    const tokens = await DeviceToken.find({ user: { $in: users.map((u) => u._id) }, active: true })
      .select('token')
      .lean();
    const res = await sendPushToTokens(
      tokens.map((t) => t.token),
      {
        title: org.name,
        body: title ? `${title}: ${body}` : body,
        data: { type: PUSH_PREF, organizationId: String(org._id), organizationSlug: org.slug },
        url: url ?? orgSiteUrl(org),
      },
    );
    return { sent: res.successCount };
  } catch (err) {
    logger.error('[org-notify] push failed:', err.message);
    return { sent: 0 };
  }
};

/** Announcement: a push and an email to every active student. */
export const announceToOrgStudents = async (org, text) => {
  const url = orgSiteUrl(org);
  const pushed = await pushToOrgStudents(org, { body: text, url });
  try {
    const ids = await activeStudentIds(org._id);
    const users = await User.find({ _id: { $in: ids }, [`notificationPreferences.${PUSH_PREF}`]: { $ne: false } })
      .select('email')
      .lean();
    for (const user of users) {
      await sendOrgAnnouncementEmail({ org, to: user.email, text, url }).catch((err) =>
        logger.error('[org-notify] announcement email failed:', err.message),
      );
    }
    return { pushed: pushed.sent, emailed: users.length };
  } catch (err) {
    logger.error('[org-notify] announcement fan-out failed:', err.message);
    return { pushed: pushed.sent, emailed: 0 };
  }
};

export const inviteLink = (token) => `${config.CLIENT_URL}/invitations/accept?token=${encodeURIComponent(token)}`;

/** The invitation email, with the organisation as the sender. */
export const emailOrgInvitation = (org, { email, role, token, inviterName }) =>
  sendOrgInvitationEmail({
    org,
    to: email,
    role,
    inviterName,
    url: inviteLink(token),
  }).catch((err) => logger.error('[org-notify] invitation email failed:', err.message));
