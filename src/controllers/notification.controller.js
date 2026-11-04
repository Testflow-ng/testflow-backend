import {
  registerDeviceToken,
  unregisterDeviceToken,
  getUserPreferences,
  updateUserPreferences,
  sendToUser,
  broadcastAnnouncement,
} from '../services/notification.service.js';
import { Announcement } from '../models/Announcement.js';
import { isFcmConfigured } from '../services/fcm.service.js';

export const registerToken = async (req, res, next) => {
  try {
    const { token, platform, deviceName } = req.body;
    if (!token) {
      return res.status(400).json({ error: { code: 'TOKEN_REQUIRED', message: 'Token is required' } });
    }

    const doc = await registerDeviceToken({
      userId: req.user._id,
      token,
      platform,
      deviceName,
    });

    res.json({ success: true, registered: Boolean(doc) });
  } catch (err) {
    next(err);
  }
};

export const unregisterToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    await unregisterDeviceToken({
      userId: req.user._id,
      token,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const getPreferences = async (req, res, next) => {
  try {
    const preferences = await getUserPreferences(req.user._id);
    res.json({ preferences, fcmConfigured: isFcmConfigured() });
  } catch (err) {
    next(err);
  }
};

export const updatePreferences = async (req, res, next) => {
  try {
    const preferences = await updateUserPreferences(req.user._id, req.body);
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
};

export const sendTestPush = async (req, res, next) => {
  try {
    const result = await sendToUser(req.user._id, {
      type: 'announcement',
      title: '🔔 TestFlow Notifications Active!',
      body: 'Push notifications are configured and working properly on your device.',
      url: '/settings/notifications',
      force: true,
    });
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
};

export const broadcast = async (req, res, next) => {
  try {
    const { title, body, channel = 'all', target = 'all', linkUrl } = req.body;
    if (!title || !body) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Title and body are required' },
      });
    }

    const announcement = await broadcastAnnouncement({
      senderId: req.user._id,
      title,
      body,
      channel,
      target,
      linkUrl,
    });

    res.status(201).json({ success: true, announcement });
  } catch (err) {
    next(err);
  }
};

export const listAnnouncements = async (req, res, next) => {
  try {
    const list = await Announcement.find()
      .populate('sender', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json({ announcements: list });
  } catch (err) {
    next(err);
  }
};
