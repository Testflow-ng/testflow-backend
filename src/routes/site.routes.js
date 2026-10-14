import { Router } from 'express';
import * as site from '../controllers/site.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
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

/** GET /api/v1/everybody/organizations/:organizationId/site — get site config */
router.get(
  '/:organizationId/site',
  authenticate,
  validate(siteGetSchema),
  requireOrgRole('owner', 'admin'),
  site.get,
);

/** PATCH /api/v1/everybody/organizations/:organizationId/site — edit draft */
router.patch(
  '/:organizationId/site',
  authenticate,
  validate(sitePatchSchema),
  requireOrgRole('owner', 'admin'),
  site.patch,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/preview — preview draft */
router.post(
  '/:organizationId/site/preview',
  authenticate,
  validate(sitePublishSchema),
  requireOrgRole('owner', 'admin'),
  site.publishPreview,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/publish — publish draft */
router.post(
  '/:organizationId/site/publish',
  authenticate,
  validate(sitePublishSchema),
  requireOrgRole('owner', 'admin'),
  site.publish,
);

/** POST /api/v1/everybody/organizations/:organizationId/site/assets — upload asset */
router.post(
  '/:organizationId/site/assets',
  authenticate,
  validate(siteAssetsSchema),
  requireOrgRole('owner', 'admin'),
  site.uploadAsset,
);

export default router;