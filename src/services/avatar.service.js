import sharp from 'sharp';
import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import * as r2 from '../utils/r2.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const uploadAvatar = async (user, file) => {
  if (!file || !file.buffer) {
    throw new AppError(422, 'NO_FILE', 'No image file uploaded.');
  }
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    throw new AppError(422, 'INVALID_FORMAT', 'Only JPEG, PNG, or WebP images are allowed.');
  }
  if (file.buffer.length > MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'Image must be under 5 MB.');
  }

  // Crop to square and resize to 400x400 WebP
  let optimized;
  try {
    optimized = await sharp(file.buffer)
      .rotate() // auto-orient based on EXIF
      .resize(400, 400, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    throw new AppError(422, 'INVALID_IMAGE', 'The file could not be processed as an image.');
  }

  const hash = crypto.createHash('sha256').update(optimized).digest('hex').slice(0, 12);
  const key = `avatars/${user._id}-${hash}.webp`;

  await r2.putObject(key, optimized, 'image/webp', 'public, max-age=31536000, immutable');
  const avatarUrl = r2.publicUrlFor(key);

  // If user had a previous custom R2 avatar, clean it up asynchronously
  if (user.avatarUrl && user.avatarUrl.includes('/avatars/')) {
    try {
      const oldKey = user.avatarUrl.split('/avatars/')[1];
      if (oldKey && oldKey !== `${user._id}-${hash}.webp`) {
        await r2.deleteObject(`avatars/${oldKey}`);
      }
    } catch {
      // Ignore cleanup error for old avatars
    }
  }

  user.avatarUrl = avatarUrl;
  await user.save();
  return user;
};

export const deleteAvatar = async (user) => {
  if (user.avatarUrl && user.avatarUrl.includes('/avatars/')) {
    try {
      const oldKey = user.avatarUrl.split('/avatars/')[1];
      if (oldKey) await r2.deleteObject(`avatars/${oldKey}`);
    } catch {
      // Ignore
    }
  }
  user.avatarUrl = null;
  await user.save();
  return user;
};

