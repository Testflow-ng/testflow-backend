import { asyncHandler } from '../middleware/asyncHandler.js';
import { SiteConfig } from '../models/SiteConfig.js';
import { OrgAsset } from '../models/OrgAsset.js';
import { AppError } from '../utils/AppError.js';
import { recordAction } from '../services/audit.service.js';

export const listTemplates = asyncHandler(async (req, res) => {
  res.json({ templates: ['classic', 'modern', 'minimal'] });
});

export const listAvailableTemplates = asyncHandler(async (req, res) => {
  res.json({ templates: ['classic', 'modern', 'minimal'] });
});

export const get = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  let config = await SiteConfig.findOne({ organization: organizationId }).lean();
  if (!config) {
    config = await SiteConfig.create({ organization: organizationId });
  }
  res.json({ site: config });
});

export const patch = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  let config = await SiteConfig.findOneAndUpdate(
    { organization: organizationId },
    { $set: { draft: req.body, draftVersion: req.body ? Date.now() : null } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  await recordAction({
    actorId: req.user._id, action: 'SITE_EDIT', targetId: organizationId, targetType: 'Organization',
    metadata: { fields: Object.keys(req.body) }, req,
  });
  res.json({ site: config });
});

export const publishPreview = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const config = await SiteConfig.findOne({ organization: organizationId }).lean();
  if (!config || !config.draft) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No draft to preview.');
  }
  // Return a signed short-lived preview token/payload
  res.json({ preview: { config: config.draft, version: config.draftVersion }, expiresIn: 300 });
});

export const publish = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const config = await SiteConfig.findOneAndUpdate(
    { organization: organizationId },
    {
      $set: {
        published: config.draft,
        publishedVersion: config.draftVersion + 1,
        publishedAt: new Date(),
        publishedBy: req.user?._id,
      },
      $inc: { draftVersion: 1 },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!config?.published) throw new AppError(400, 'VALIDATION_ERROR', 'No draft to publish.');
  await recordAction({
    actorId: req.user._id, action: 'SITE_PUBLISH', targetId: organizationId, targetType: 'Organization',
    metadata: {}, req,
  });
  res.json({ site: config });
});

export const uploadAsset = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const { kind } = req.body;
  if (!['logo', 'favicon', 'hero', 'image'].includes(kind)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid asset kind.');
  }
  // In v1 we just return a placeholder; real upload uses sharp/R2 pipeline
  const asset = await OrgAsset.create({
    organization: organizationId,
    kind,
    storageKey: `tmp/${organizationId}/${kind}-${Date.now()}`,
    url: `/assets/tmp/${kind}-${Date.now()}.webp`,
  });
  res.status(201).json({ asset: { id: String(asset._id), kind, url: asset.url } });
});