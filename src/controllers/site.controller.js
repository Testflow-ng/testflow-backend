import { asyncHandler } from '../middleware/asyncHandler.js';
import * as site from '../services/orgSite.service.js';
import { recordAction } from '../services/audit.service.js';

export const listTemplates = asyncHandler(async (_req, res) => {
  res.json({ templates: site.TEMPLATES });
});

/** GET /api/v1/everybody/organizations/:organizationId/site */
export const get = asyncHandler(async (req, res) => {
  res.json({ site: await site.getSite(req.params.organizationId) });
});

/** PATCH /api/v1/everybody/organizations/:organizationId/site */
export const patch = asyncHandler(async (req, res) => {
  const view = await site.patchSite(req.params.organizationId, req.body);
  await recordAction({
    actorId: req.user._id, action: 'SITE_EDIT', targetId: req.org._id, targetType: 'Organization',
    metadata: { fields: Object.keys(req.body) }, req,
  });
  res.json({ site: view });
});

/** POST /api/v1/everybody/organizations/:organizationId/site/preview */
export const publishPreview = asyncHandler(async (req, res) => {
  res.json(await site.previewSite(req.params.organizationId));
});

/** POST /api/v1/everybody/organizations/:organizationId/site/publish */
export const publish = asyncHandler(async (req, res) => {
  const view = await site.publishSite(req.params.organizationId, req.user._id);
  await recordAction({
    actorId: req.user._id, action: 'SITE_PUBLISH', targetId: req.org._id, targetType: 'Organization',
    metadata: { version: view.version }, req,
  });
  res.json({ site: view });
});

/** POST /api/v1/everybody/organizations/:organizationId/site/assets (multipart, field "file") */
export const uploadAsset = asyncHandler(async (req, res) => {
  const asset = await site.uploadSiteAsset(req.org, req.file, req.body.kind ?? 'image', req.user._id);
  res.status(201).json({ asset });
});

/** POST /api/v1/everybody/organizations/:organizationId/questions/assets shares the same uploader. */
export const uploadQuestionAsset = asyncHandler(async (req, res) => {
  const asset = await site.uploadSiteAsset(req.org, req.file, 'image', req.user._id);
  res.status(201).json({ asset });
});
