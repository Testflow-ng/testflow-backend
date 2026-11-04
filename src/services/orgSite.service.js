import { SiteConfig, SITE_TEMPLATES, DEFAULT_SITE_PAGES } from '../models/SiteConfig.js';
import { OrgDomain } from '../models/OrgDomain.js';
import { Organization } from '../models/Organization.js';
import { entitlementsFor } from './entitlements.js';
import { storeOrgImage } from './orgMedia.service.js';
import { advertisingConfig } from '../config/advertising.js';

/**
 * The site builder: the flat config the console edits, the asset uploader behind its image fields,
 * and the payload a tenant host renders for a crawler or a visitor.
 *
 * Everything the console sends is a *surface*: a brand, a landing block list, a portal block list,
 * the page switches and a footer. `draft` is what the owner is editing, `published` is what the
 * public sees, and publishing copies the draft across in one move, so an unfinished edit is never
 * half-live.
 */

export const DEFAULT_BRAND = Object.freeze({
  name: null,
  tagline: null,
  logoUrl: null,
  logoAssetId: null,
  faviconUrl: null,
  faviconAssetId: null,
  primaryColor: '#163a5f',
  accentColor: '#f5c542',
  font: 'inter',
});

export const TEMPLATES = SITE_TEMPLATES;

/** Fill an absent surface with sane defaults, so a brand-new org still renders. */
export const normalizeSurface = (surface = {}) => {
  const s = surface ?? {};
  return {
    brand: { ...DEFAULT_BRAND, ...(s.brand ?? {}) },
    landing: { sections: Array.isArray(s.landing?.sections) ? s.landing.sections : [] },
    portal: {
      welcome: {
        heading: s.portal?.welcome?.heading ?? '',
        text: s.portal?.welcome?.text ?? '',
        imageUrl: s.portal?.welcome?.imageUrl ?? '',
      },
      sections: Array.isArray(s.portal?.sections) ? s.portal.sections : [],
    },
    pages: { ...DEFAULT_SITE_PAGES, ...(s.pages ?? {}) },
    footer: {
      text: s.footer?.text ?? '',
      links: Array.isArray(s.footer?.links) ? s.footer.links : [],
    },
  };
};

/** The one shape `GET` and `PATCH` return: the flat console view. */
export const toSiteView = (config) => {
  const draft = normalizeSurface(config?.draft);
  const published = config?.published ? normalizeSurface(config.published) : null;
  const draftVersion = config?.draftVersion ?? 0;
  const publishedVersion = config?.publishedVersion ?? 0;
  return {
    template: config?.template ?? 'modern',
    ...draft,
    version: draftVersion,
    publishedAt: config?.publishedAt ?? null,
    hasUnpublished: !published || draftVersion > publishedVersion,
    published: published ? { ...published, version: publishedVersion, publishedAt: config?.publishedAt ?? null } : null,
  };
};

const getOrCreate = async (orgId) => {
  const existing = await SiteConfig.findOne({ organization: orgId });
  if (existing) return existing;
  return SiteConfig.create({ organization: orgId, draft: normalizeSurface({}) });
};

export const getSite = async (orgId) => toSiteView(await getOrCreate(orgId));

/**
 * Merge a validated patch into the draft. `brand` and `pages` merge field-by-field (the Domains
 * screen sends only a brand, and it must not wipe the colours); the block lists and footer are
 * replaced because the console always sends the whole list.
 */
const mergeSurface = (base, body) => {
  const next = { ...base };
  if (body.brand) next.brand = { ...base.brand, ...body.brand };
  if (body.pages) next.pages = { ...base.pages, ...body.pages };
  if (body.landing) next.landing = { sections: body.landing.sections ?? base.landing.sections };
  if (body.portal) {
    next.portal = {
      welcome: body.portal.welcome ? { ...base.portal.welcome, ...body.portal.welcome } : base.portal.welcome,
      sections: body.portal.sections ?? base.portal.sections,
    };
  }
  if (body.footer) next.footer = { text: body.footer.text ?? base.footer.text, links: body.footer.links ?? base.footer.links };
  return next;
};

export const patchSite = async (orgId, body) => {
  const config = await getOrCreate(orgId);
  config.draft = mergeSurface(normalizeSurface(config.draft), body);
  config.draftVersion = (config.draftVersion ?? 0) + 1;
  if (body.template) config.template = body.template;
  await config.save();
  return toSiteView(config);
};

export const previewSite = async (orgId) => {
  const config = await getOrCreate(orgId);
  return { preview: normalizeSurface(config.draft), version: config.draftVersion ?? 0, expiresIn: 300 };
};

/** Publish the draft. The OG image is rendered on demand, so there is no cache to bust here. */
export const publishSite = async (orgId, actorId) => {
  const config = await getOrCreate(orgId);
  config.published = normalizeSurface(config.draft);
  config.publishedVersion = config.draftVersion ?? 0;
  config.publishedAt = new Date();
  config.publishedBy = actorId ?? undefined;
  await config.save();
  return toSiteView(config);
};

/**
 * Accept an uploaded image. The decoding, re-encode, quota and count checks all live in
 * `orgMedia.service`, so a site logo and a question image follow exactly the same rules.
 */
export const uploadSiteAsset = (org, file, kind = 'image', actorId) =>
  storeOrgImage(org, file, kind, actorId);

/**
 * Resolve a hostname to its organisation.
 *
 * A subdomain is stored as the full hostname; a lookup that misses falls back to parsing the slug
 * out of `<slug>.testflow.com.ng`, so a site is reachable before its domain row is written. The
 * organisation must be active; whether a site has been published is the caller's question (the
 * public site needs it, tenant sign-in does not).
 */
export const findSiteByHostname = async (hostname) => {
  const host = String(hostname ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!host) return null;

  const domain = await OrgDomain.findOne({ hostname: host, status: { $ne: 'removed' } }).lean();
  let orgId = domain?.organization ?? null;

  if (!orgId && host.endsWith('.testflow.com.ng')) {
    const slug = host.slice(0, -'.testflow.com.ng'.length);
    const org = await Organization.findOne({ slug, status: 'active' }).select('_id').lean();
    orgId = org?._id ?? null;
  }
  if (!orgId) return null;

  const [org, config] = await Promise.all([
    Organization.findById(orgId).select('name slug status').lean(),
    SiteConfig.findOne({ organization: orgId }).lean(),
  ]);
  if (!org || org.status !== 'active') return null;

  return { org, config: config ?? null, host, domain: domain ?? null };
};

/** True once an owner has published at least once. */
export const hasPublishedSite = (resolved) => Boolean(resolved?.config?.published);

const NO_ADS = Object.freeze({
  enabled: false,
  publisherId: null,
  slots: Object.freeze({ portal_home: null, before_corrections: null }),
});

/**
 * The organiser's plan decides whether its students see ads. Free and Pro do, Studio does not;
 * with no publisher configured the answer is always off, so a local server renders no ad frames.
 */
export const tenantAdsFor = async (org) => {
  const ent = await entitlementsFor(org._id).catch(() => null);
  const advertising = advertisingConfig();
  const google = advertising.providers.google_adsense;
  const publisherId = google.publisherId ?? null;
  const enabled = Boolean(ent?.adsEnabled && google.enabled && publisherId);
  if (!enabled) return { ...NO_ADS, slots: { ...NO_ADS.slots } };
  return {
    enabled: true,
    publisherId,
    // The two tenant placements reuse the already-approved feed and post-activity units.
    slots: {
      portal_home: google.adUnits?.content_feed ?? null,
      before_corrections: google.adUnits?.post_activity ?? null,
    },
  };
};

/** The public payload: the published surface plus the metadata a crawler reads. */
export const publicSiteView = (resolved, origin, ads = NO_ADS) => {
  const surface = normalizeSurface(resolved.config?.published);
  const name = surface.brand.name || resolved.org.name;
  const description = surface.brand.tagline || `${name} online practice exams.`;
  const ogImageUrl = `${origin}/api/v1/public/site/og.png?host=${encodeURIComponent(resolved.host)}`;
  const canonicalUrl = `${origin}/`;
  return {
    organization: { id: String(resolved.org._id), name: resolved.org.name, slug: resolved.org.slug },
    site: { template: resolved.config?.template ?? 'modern', ...surface, ads },
    meta: {
      title: surface.brand.tagline ? `${name} | ${surface.brand.tagline}` : name,
      description,
      ogImageUrl,
      themeColor: surface.brand.primaryColor ?? '#163a5f',
      faviconUrl: surface.brand.faviconUrl ?? null,
      canonicalUrl,
    },
  };
};
