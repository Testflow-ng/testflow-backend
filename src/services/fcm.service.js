import { initializeApp, cert, applicationDefault, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { DeviceToken } from '../models/DeviceToken.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultKeyPath = path.resolve(__dirname, '../../serviceAccountKey.json');

let isInitialized = false;
let messagingInstance = null;

const initFirebase = () => {
  if (isInitialized && messagingInstance) return messagingInstance;

  try {
    let credential = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (raw.startsWith('{')) {
        credential = cert(JSON.parse(raw));
      } else {
        const resolvedPath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
        if (fs.existsSync(resolvedPath)) {
          const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
          credential = cert(JSON.parse(fileContent));
        }
      }
    } else if (fs.existsSync(defaultKeyPath)) {
      const fileContent = fs.readFileSync(defaultKeyPath, 'utf-8');
      credential = cert(JSON.parse(fileContent));
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      credential = cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      credential = applicationDefault();
    }

    if (credential) {
      const existingApp = getApps().find((a) => a.name === 'testflow-fcm');
      const app = existingApp || initializeApp({ credential }, 'testflow-fcm');
      messagingInstance = getMessaging(app);
      isInitialized = true;
      logger.info('[fcm] Firebase Admin SDK successfully initialized (testflow-9bda9)');
    } else {
      logger.info('[fcm] Firebase credentials not configured. Operating in simulation mode.');
    }
  } catch (error) {
    logger.warn('[fcm] Failed to initialize Firebase Admin SDK, falling back to mock mode:', error.message);
  }

  return messagingInstance;
};

export const isFcmConfigured = () => {
  initFirebase();
  return Boolean(messagingInstance);
};

/**
 * Send push notification to a list of device tokens.
 * Automatically deactivates unregistered or stale tokens from the database.
 */
export const sendPushToTokens = async (tokens, { title, body, data = {}, icon = '/icons/icon-192x192.png', badge = '/icons/badge-72x72.png', url = '/' } = {}) => {
  if (!tokens || !tokens.length) {
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }

  const messaging = initFirebase();

  if (!messaging) {
    logger.info(`[fcm] (Simulation) Delivered push to ${tokens.length} token(s): "${title}" - "${body}"`);
    return { successCount: tokens.length, failureCount: 0, failedTokens: [] };
  }

  // FCM multicast supports up to 500 tokens per batch
  const BATCH_SIZE = 500;
  let totalSuccess = 0;
  let totalFailure = 0;
  const invalidTokens = [];

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);

    const message = {
      tokens: batch,
      notification: {
        title,
        body,
      },
      data: {
        ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        url: url || '/',
      },
      webpush: {
        notification: {
          title,
          body,
          icon,
          badge,
          data: { url: url || '/' },
        },
        fcmOptions: {
          link: url || '/',
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === 'messaging/registration-token-not-registered' ||
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/invalid-argument'
          ) {
            invalidTokens.push(batch[idx]);
          }
        }
      });
    } catch (err) {
      logger.error('[fcm] Batch multicast failed:', err);
      totalFailure += batch.length;
    }
  }

  // Deactivate bad tokens so future sends don't waste calls
  if (invalidTokens.length) {
    DeviceToken.updateMany({ token: { $in: invalidTokens } }, { $set: { active: false } })
      .catch((err) => logger.error('[fcm] Failed to deactivate invalid tokens:', err));
  }

  return {
    successCount: totalSuccess,
    failureCount: totalFailure,
    failedTokens: invalidTokens,
  };
};
