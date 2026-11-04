import { User } from '../models/User.js';
import { DeviceToken } from '../models/DeviceToken.js';
import { Announcement } from '../models/Announcement.js';
import { StudentEntitlement } from '../models/StudentEntitlement.js';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';
import { sendPushToTokens } from './fcm.service.js';
import { sendStudentAnnouncementEmail } from './email.service.js';

export const NOTIFICATION_TYPES = Object.freeze([
  'exam_reminders',
  'live_cbt',
  'achievements',
  'ai_suggestions',
  'streak',
  'announcement',
]);

/**
 * Register or update an FCM device token for a user.
 */
export const registerDeviceToken = async ({ userId, token, platform = 'web', deviceName = null }) => {
  if (!token) throw new Error('Token is required');

  const doc = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        user: userId,
        platform,
        deviceName,
        active: true,
        lastUsedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return doc;
};

/**
 * Unregister/deactivate an FCM device token (e.g. on logout or permissions revoking).
 */
export const unregisterDeviceToken = async ({ userId, token }) => {
  if (!token) return null;
  return DeviceToken.findOneAndUpdate(
    { token, user: userId },
    { $set: { active: false } },
    { new: true },
  );
};

/**
 * Get notification preferences for a user.
 */
export const getUserPreferences = async (userId) => {
  const user = await User.findById(userId).select('notificationPreferences').lean();
  const defaults = {
    exam_reminders: true,
    live_cbt: true,
    achievements: true,
    ai_suggestions: true,
    streak: true,
  };
  return { ...defaults, ...(user?.notificationPreferences || {}) };
};

/**
 * Update notification preferences for a user.
 */
export const updateUserPreferences = async (userId, newPreferences = {}) => {
  const current = await getUserPreferences(userId);
  const updated = { ...current, ...newPreferences };

  await User.findByIdAndUpdate(userId, {
    $set: { notificationPreferences: updated },
  });

  return updated;
};

/**
 * Send a notification to a specific user (verifying their preferences).
 */
export const sendToUser = async (userId, { type = 'announcement', title, body, data = {}, url = '/', force = false }) => {
  const user = await User.findById(userId).select('fullName email notificationPreferences').lean();
  if (!user) return { sent: false, reason: 'user_not_found' };

  // Check preferences unless forced (e.g. urgent account security or billing alert)
  if (!force && type && user.notificationPreferences && user.notificationPreferences[type] === false) {
    return { sent: false, reason: 'disabled_by_user_preferences' };
  }

  const tokens = await DeviceToken.find({ user: userId, active: true }).select('token').lean();
  if (!tokens.length) {
    return { sent: false, reason: 'no_active_tokens' };
  }

  const tokenList = tokens.map((t) => t.token);
  const res = await sendPushToTokens(tokenList, {
    title,
    body,
    data: { ...data, type },
    url,
  });

  return { sent: res.successCount > 0, stats: res };
};

/**
 * Admin broadcast: Send an announcement to all or targeted users via Push, Email, or Both.
 */
export const broadcastAnnouncement = async ({
  senderId,
  title,
  body,
  channel = 'all', // 'all', 'push', 'email'
  target = 'all',  // 'all', 'students', 'plus', 'admins'
  linkUrl = null,
}) => {
  // 1. Determine target user query
  let userQuery = {};
  if (target === 'students') {
    userQuery = { role: 'student' };
  } else if (target === 'admins') {
    userQuery = { role: { $in: ['admin', 'super_admin'] } };
  } else if (target === 'plus') {
    const activePasses = await StudentEntitlement.find({
      key: 'ad_free',
      active: true,
      expiresAt: { $gt: new Date() },
    }).select('user').lean();
    const userIds = [...new Set(activePasses.map((p) => p.user))];
    userQuery = { _id: { $in: userIds } };
  }

  const users = await User.find(userQuery).select('_id fullName email').lean();
  const recipientCount = users.length;
  const userIds = users.map((u) => u._id);

  let pushSent = 0;
  let pushFailed = 0;
  let emailSent = 0;
  let emailFailed = 0;

  // 2. Dispatch Push Notifications
  if (channel === 'push' || channel === 'all') {
    const activeTokens = await DeviceToken.find({
      user: { $in: userIds },
      active: true,
    }).select('token').lean();

    if (activeTokens.length) {
      const tokenList = activeTokens.map((t) => t.token);
      const pushResult = await sendPushToTokens(tokenList, {
        title,
        body,
        data: { type: 'announcement' },
        url: linkUrl || '/',
      });
      pushSent = pushResult.successCount;
      pushFailed = pushResult.failureCount;
    }
  }

  // 3. Save Announcement Record
  const announcement = await Announcement.create({
    sender: senderId,
    title,
    body,
    channel,
    target,
    linkUrl,
    stats: {
      pushSent,
      pushFailed,
      emailSent: 0,
      emailFailed: 0,
      totalRecipients: recipientCount,
    },
  });

  // 4. Dispatch Emails
  if (channel === 'email' || channel === 'all') {
    // Process emails in non-blocking batches
    const sendEmailsAsync = async () => {
      for (const recipient of users) {
        if (!recipient.email) continue;
        try {
          await sendStudentAnnouncementEmail({
            user: recipient,
            title,
            body,
            linkUrl,
          });
          emailSent += 1;
        } catch (err) {
          emailFailed += 1;
          logger.error(`[broadcast] Failed sending email to ${recipient.email}:`, err.message);
        }
      }

      await Announcement.findByIdAndUpdate(announcement._id, {
        $set: {
          'stats.emailSent': emailSent,
          'stats.emailFailed': emailFailed,
        },
      });
    };

    // Run email deliveries in background
    setTimeout(sendEmailsAsync, 10).unref?.();
  }

  // 5. Audit Log
  await AuditLog.create({
    actor: senderId,
    action: 'ADMIN_ANNOUNCEMENT_BROADCAST',
    targetId: announcement._id,
    targetType: 'Announcement',
    metadata: {
      title,
      channel,
      target,
      recipients: recipientCount,
    },
  });

  return announcement;
};

// ==========================================
// PRE-BUILT NOTIFICATION EVENT HELPERS
// ==========================================

/**
 * 1. Exam Reminders:
 * Get notified before scheduled practice sessions
 */
export const notifyExamReminder = async ({ userId, examTitle, scheduledAt, examId }) => {
  return sendToUser(userId, {
    type: 'exam_reminders',
    title: '⏰ Upcoming Exam Practice',
    body: `Your scheduled session for "${examTitle}" starts soon!`,
    url: examId ? `/practice/${examId}` : '/dashboard',
    data: { examId, scheduledAt },
  });
};

/**
 * 2. Live CBT Invites:
 * When a friend creates a session you can join
 */
export const notifyLiveCbtInvite = async ({ recipientId, senderName, shareCode, examTitle }) => {
  return sendToUser(recipientId, {
    type: 'live_cbt',
    title: '🎮 Live CBT Invitation',
    body: `${senderName || 'A classmate'} invited you to join "${examTitle || 'Live CBT'}"!`,
    url: shareCode ? `/live/${shareCode}` : '/live',
    data: { shareCode },
  });
};

/**
 * 3. Achievements:
 * Celebrate when you unlock new badges
 */
export const notifyAchievementUnlocked = async ({ userId, badgeTitle, description }) => {
  return sendToUser(userId, {
    type: 'achievements',
    title: '🏆 Achievement Unlocked!',
    body: `Congratulations! You unlocked the "${badgeTitle}" badge: ${description || 'Keep it up!'}`,
    url: '/achievements',
    data: { badgeTitle },
  });
};

/**
 * 4. AI Study Tips:
 * Personalized revision recommendations
 */
export const notifyAiStudyTip = async ({ userId, tipTitle, tipBody, subjectName }) => {
  return sendToUser(userId, {
    type: 'ai_suggestions',
    title: `💡 AI Revision Tip: ${subjectName || 'Study Boost'}`,
    body: tipBody || tipTitle,
    url: '/ai-study',
    data: { subjectName },
  });
};

/**
 * 5. Streak Reminders:
 * Keep your study streak alive
 */
export const notifyStreakReminder = async ({ userId, streakDays }) => {
  return sendToUser(userId, {
    type: 'streak',
    title: '🔥 Keep your streak alive!',
    body: `You are on a ${streakDays || 1}-day streak! Practice a few questions today to keep your fire burning.`,
    url: '/dashboard',
    data: { streakDays },
  });
};
