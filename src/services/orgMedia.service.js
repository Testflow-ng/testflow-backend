import crypto from 'node:crypto';
import sharp from 'sharp';
import { OrgAsset } from '../models/OrgAsset.js';
import { AppError } from '../utils/AppError.js';
import { putObject, publicUrlFor } from '../utils/r2.js';
import { entitlementsFor } from './entitlements.js';

/**
 * Organisation image intake.
 *
 * The bytes are decoded, never the client's extension or MIME. Only a real PNG, JPEG or WebP is
 * accepted, one frame only, within a sane pixel budget; the image is then re-encoded to WebP, which
 * strips EXIF and GPS as a side effect, and the stored object is the re-encoded bytes. Storage is
 * metered per organisation against the plan's `storageMb` and `maxImages`.
 */

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 6000;
const MAX_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp']);

/** Decode and normalise. Pure: no storage, no quota, so it can be unit tested. */
export const prepareOrgImage = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(422, 'INVALID_IMAGE', 'Send one image file.');
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new AppError(422, 'FILE_TOO_LARGE', 'Images must be 2 MB or smaller.');
  }

  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new AppError(422, 'UNSUPPORTED_TYPE', 'That file is not a readable image.');
  }
  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw new AppError(422, 'UNSUPPORTED_TYPE', 'Use a PNG, JPEG or WebP image.');
  }
  if ((meta.pages ?? 1) > 1 || meta.pageHeight) {
    throw new AppError(422, 'ANIMATED_IMAGE', 'Animated images are not allowed.');
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new AppError(422, 'UNSUPPORTED_TYPE', 'That image has no usable dimensions.');
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new AppError(422, 'IMAGE_TOO_LARGE', `Images must be at most ${MAX_SIDE}x${MAX_SIDE} pixels.`);
  }

  let output;
  try {
    output = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(422, 'UNSUPPORTED_TYPE', 'That image could not be processed.');
  }

  return {
    buffer: output.data,
    contentType: 'image/webp',
    ext: 'webp',
    width: output.info.width ?? width,
    height: output.info.height ?? height,
    bytes: output.data.length,
    sourceFormat: meta.format,
  };
};

const usedBytes = async (orgId) => {
  const rows = await OrgAsset.find({ organization: orgId }).select('size').lean();
  return rows.reduce((sum, row) => sum + (row.size ?? 0), 0);
};

/**
 * Quota checks run before the object store is touched, so a plan that is full is refused even if
 * storage is down. The count cap is per organisation, across every image kind.
 */
export const storeOrgImage = async (org, file, kind = 'image', actorId) => {
  if (!file?.buffer) throw new AppError(422, 'INVALID_UPLOAD', 'Send one image in the "file" field.');

  const ent = await entitlementsFor(org._id).catch(() => null);
  const maxImages = ent?.maxImages ?? null;
  if (maxImages != null) {
    const count = await OrgAsset.countDocuments({ organization: org._id });
    if (count >= maxImages) {
      throw new AppError(422, 'STORAGE_LIMIT', 'This plan is out of image slots. Remove some images or upgrade.');
    }
  }

  const prepared = await prepareOrgImage(file.buffer);

  const capBytes = ent?.storageMb ? ent.storageMb * 1024 * 1024 : null;
  if (capBytes) {
    const used = await usedBytes(org._id);
    if (used + prepared.bytes > capBytes) {
      throw new AppError(422, 'STORAGE_LIMIT', 'This plan is out of image storage. Remove some images or upgrade.');
    }
  }

  const storageKey = `org/${org._id}/${kind}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
  await putObject(storageKey, prepared.buffer, prepared.contentType);
  const url = publicUrlFor(storageKey);

  const asset = await OrgAsset.create({
    organization: org._id,
    kind,
    storageKey,
    url,
    mimeType: prepared.contentType,
    size: prepared.bytes,
    uploadedBy: actorId,
  });

  return {
    id: String(asset._id),
    kind,
    url,
    width: prepared.width,
    height: prepared.height,
    bytes: prepared.bytes,
    contentType: prepared.contentType,
  };
};
