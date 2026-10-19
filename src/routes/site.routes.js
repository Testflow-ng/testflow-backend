import { Router } from 'express';
import * as site from '../controllers/site.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { singleImage } from '../middleware/uploadImage.js';
import {
  listTemplatesSchema,
  siteGetSchema,
  sitePatchSchema,
  sitePublishSchema,
  siteAssetsSchema,
} from '../validators/everybody.schema.js';

const router = Router();

/** GET /api/v1/everybody/templates — list available templates */
router.get('/templates', authenticate, validate(listTemplatesSchema), site.listTemplates);

/** GET /api/v1/everybody/organizations/:organizationId/site — the flat config the console edits */
router.get(
  '/organizations/:organizationId/site',
  authenticate,
  validate(siteGetSchema),
  requireOrgRole('owner', 'admin'),
  site.get,
);

/** PATCH /api/v1/everybody/organizations/:organizationId/site — merge an edit into the draft */
router.patch(
  '/organizations/:organizationId/site',
  authenticate,
  validate(sitePatchSchema),
  requireOrgRole('owner', 'admin'),
  site.patch,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/preview — render the draft */
router.post(
  '/organizations/:organizationId/site/preview',
  authenticate,
  validate(sitePublishSchema),
  requireOrgRole('owner', 'admin'),
  site.publishPreview,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/publish — copy draft to live */
router.post(
  '/organizations/:organizationId/site/publish',
  authenticate,
  validate(sitePublishSchema),
  requireOrgRole('owner', 'admin'),
  site.publish,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/assets — multipart image upload */
router.post(
  '/organizations/:organizationId/site/assets',
  authenticate,
  requireOrgRole('owner', 'admin'),
  singleImage('file'),
  validate(siteAssetsSchema),
  site.uploadAsset,
);

export default router;
