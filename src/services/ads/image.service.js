import crypto from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../utils/AppError.js';
import { AdAsset } from '../../models/AdAsset.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MIN = { width: 300, height: 150 };
const MAX_PIXELS_SIDE = 8000;
const OUTPUT_MAX_SIDE = 1280;

/**
 * Validate by decoding the actual bytes (extension / client MIME are never
 * consulted), then re-encode to WebP: strips all metadata (EXIF/GPS), applies
 * orientation, caps dimensions and tunes quality toward `imageTargetBytes`.
 */
export const optimizeAdImage = async (input, { imageTargetBytes, imageMaxBytes }) => {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new AppError(422, 'INVALID_IMAGE', 'No image data received.');
  }
  if (input.length > imageMaxBytes) {
    throw new AppError(413, 'IMAGE_TOO_LARGE', `Image must be at most ${Math.round(imageMaxBytes / 1024 / 1024)} MB.`);
  }

  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
  } catch {
    throw new AppError(422, 'INVALID_IMAGE', 'The file is not a valid image.');
  }
  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw new AppError(422, 'UNSUPPORTED_IMAGE_FORMAT', 'Only JPEG, PNG or WebP images are supported.');
  }
  if ((meta.pages ?? 1) > 1) {
    throw new AppError(422, 'ANIMATED_IMAGE_NOT_ALLOWED', 'Animated images are not supported.');
  }
  // EXIF orientation 5-8 swaps width/height once rotated.
  const swapped = meta.orientation >= 5;
  const srcW = swapped ? meta.height : meta.width;
  const srcH = swapped ? meta.width : meta.height;
  if (srcW < MIN.width || srcH < MIN.height) {
    throw new AppError(422, 'IMAGE_TOO_SMALL', `Image must be at least ${MIN.width}×${MIN.height} pixels.`);
  }
  if (srcW > MAX_PIXELS_SIDE || srcH > MAX_PIXELS_SIDE) {
    throw new AppError(422, 'IMAGE_TOO_LARGE_DIMENSIONS', `Image sides must be at most ${MAX_PIXELS_SIDE} pixels.`);
  }

  const encode = (side, quality) =>
    sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

  let result;
  for (const [side, quality] of [[OUTPUT_MAX_SIDE, 82], [OUTPUT_MAX_SIDE, 70], [OUTPUT_MAX_SIDE, 58], [960, 55], [720, 50]]) {
    result = await encode(side, quality);
    if (result.data.length <= imageTargetBytes) break;
  }
  if (result.data.length > imageMaxBytes) {
    throw new AppError(422, 'IMAGE_TOO_COMPLEX', 'Image could not be compressed enough. Please use a simpler image.');
  }
  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    format: 'webp',
    bytes: result.data.length,
    sha256: crypto.createHash('sha256').update(result.data).digest('hex'),
  };
};

let storageOverride = null;
/** Test hooks: replace remote put/delete. */
export const setStorageForTests = (impl) => { storageOverride = impl; };
const storage = async () => storageOverride ?? (await import('../../utils/r2.js'));

export const uploadAdAsset = async (user, buffer, settings) => {
  const img = await optimizeAdImage(buffer, settings);
  const r2 = await storage();
  const now = new Date();
  const key = `ads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${img.sha256.slice(0, 16)}-${crypto.randomBytes(6).toString('hex')}.webp`;
  try {
    await r2.putObject(key, img.buffer, 'image/webp');
  } catch (e) {
    if (e?.code === 'STORAGE_NOT_CONFIGURED') throw e;
    throw new AppError(502, 'STORAGE_UPLOAD_FAILED', 'Could not store the image. Please try again.');
  }
  return AdAsset.create({
    owner: user._id, storageKey: key, url: r2.publicUrlFor(key), width: img.width, height: img.height,
    bytes: img.bytes, format: img.format, sha256: img.sha256,
  });
};

/** Delete the stored object; an already-missing object counts as success. */
export const deleteStoredImage = async (storageKey) => (await storage()).deleteObject(storageKey);
