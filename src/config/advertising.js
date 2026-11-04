import { config } from './env.js';

/**
 * Provider-aware advertising configuration.
 *
 * There are two advertising providers and they are not the same kind of thing:
 *
 *  - `testflow` — the in-house marketplace. Campaigns, targeting, creative moderation, advertiser
 *    billing and impression accounting all live in `services/ads/**` and are untouched by this
 *    module. Testflow can create, approve and bill these ads.
 *  - `google_adsense` — Google's publisher product. Testflow cannot create, approve or bill these
 *    ads, and never observes a billable Google impression from the backend. All this module
 *    decides is whether a placement may carry a Google ad unit, and it reports its own
 *    configuration. Google's client-side script and reporting are the source of truth for
 *    impressions and revenue.
 *
 * Nothing here writes to the Testflow Ads collections, and a Google failure cannot disable them.
 */

export const AD_PROVIDERS = Object.freeze(['testflow', 'google_adsense']);

/**
 * The explicit scope of the ad-free entitlement: it suppresses BOTH providers across the student
 * product. Declared once, and asserted in tests, so the scope is a decision rather than a
 * side effect.
 */
export const AD_FREE_SUPPRESSED_PROVIDERS = Object.freeze([...AD_PROVIDERS]);

export const AD_CONSENT_VALUES = Object.freeze(['granted', 'denied', 'unknown']);

export const ADVERTISING_CONFIG_VERSION = 1;

/**
 * The approved placement registry.
 *
 * Safe by default: a placement not listed here does not exist, and a listed placement serves only
 * when `enabled` is true, it is not `sensitive`, and the deployment allow list permits it. The
 * sensitive entries below (exams, live rooms, checkout, auth) are registered so the registry is
 * complete and queryable, but `sensitive` wins over every allow list, so they can never serve.
 */
const definePlacement = (placement) =>
  Object.freeze({
    providers: [...AD_PROVIDERS],
    enabled: false,
    sensitive: false,
    devices: Object.freeze(['mobile', 'tablet', 'desktop']),
    contexts: Object.freeze([]),
    ...placement,
  });

export const PLACEMENTS = Object.freeze({
  content_feed: definePlacement({
    label: 'Content feed',
    enabled: true,
    contexts: Object.freeze(['question_list', 'library']),
  }),
  desktop_sidebar: definePlacement({
    label: 'Desktop sidebar',
    enabled: true,
    devices: Object.freeze(['desktop']),
    contexts: Object.freeze(['question_list', 'library']),
  }),
  post_activity: definePlacement({
    label: 'After a completed learning activity',
    enabled: true,
    contexts: Object.freeze(['exam_session_result', 'post_utme_result']),
  }),
  // --- Sensitive flows. Registered, never eligible. ---
  exam_session: definePlacement({
    label: 'Examination session',
    sensitive: true,
    contexts: Object.freeze(['exam_session']),
  }),
  live_cbt: definePlacement({
    label: 'Live CBT room',
    sensitive: true,
    contexts: Object.freeze(['live_cbt']),
  }),
  payment_checkout: definePlacement({
    label: 'Payment checkout',
    sensitive: true,
    contexts: Object.freeze(['billing']),
  }),
  auth: definePlacement({
    label: 'Authentication',
    sensitive: true,
    contexts: Object.freeze(['auth']),
  }),
});

const parseList = (raw) =>
  typeof raw === 'string'
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const allowList = parseList(config.ADVERTISING_PLACEMENTS_ENABLED);
const denyList = new Set(parseList(config.ADVERTISING_PLACEMENTS_DISABLED));
// An explicit allow list is authoritative; otherwise the registry defaults apply. The registry
// entries carry no `id` of their own (that is added by `resolvePlacement`), so the key is the id.
const allowed = allowList.length
  ? new Set(allowList)
  : new Set(Object.entries(PLACEMENTS).filter(([, p]) => p.enabled).map(([id]) => id));

export const PLACEMENT_IDS = Object.freeze(Object.keys(PLACEMENTS));

/** The effective placement, or null when the id is not in the registry. */
export const resolvePlacement = (id) => {
  const placement = PLACEMENTS[id];
  if (!placement) return null;
  return {
    id,
    label: placement.label,
    providers: [...placement.providers],
    devices: [...placement.devices],
    contexts: [...placement.contexts],
    sensitive: placement.sensitive,
    registered: true,
    enabled: !placement.sensitive && placement.enabled && allowed.has(id) && !denyList.has(id),
  };
};

export const listPlacements = ({ enabledOnly = false } = {}) =>
  PLACEMENT_IDS.map(resolvePlacement).filter((p) => (enabledOnly ? p.enabled : true));

/** "placement:slotId" pairs. A malformed pair is dropped and reported, never guessed at. */
const parseAdUnits = () => {
  const units = {};
  const issues = [];
  for (const pair of parseList(config.GOOGLE_ADSENSE_AD_UNITS)) {
    const [placement, slot] = pair.split(':').map((s) => (s ?? '').trim());
    if (!placement || !slot) {
      issues.push({ level: 'warn', provider: 'google_adsense', code: 'AD_UNIT_MALFORMED', message: `Ignored ad unit entry "${pair}".` });
      continue;
    }
    if (!PLACEMENTS[placement]) {
      issues.push({ level: 'warn', provider: 'google_adsense', code: 'AD_UNIT_UNKNOWN_PLACEMENT', message: `Ignored ad unit for unregistered placement "${placement}".` });
      continue;
    }
    if (!/^\d{6,20}$/.test(slot)) {
      issues.push({ level: 'warn', provider: 'google_adsense', code: 'AD_UNIT_INVALID_SLOT', message: `Ignored ad unit with a non-numeric slot for "${placement}".` });
      continue;
    }
    units[placement] = slot;
  }
  return { units, issues };
};

const adUnitParse = parseAdUnits();

const testflowEnabled = config.ADVERTISING_TESTFLOW_ENABLED === 'true';
const adsenseRequested = config.GOOGLE_ADSENSE_ENABLED === 'true';
const publisherId = config.GOOGLE_ADSENSE_PUBLISHER_ID ?? null;
// Fail safe: asked for but not usable counts as off, and says why.
const adsenseEnabled = adsenseRequested && !!publisherId;

const configIssues = [...adUnitParse.issues];

if (adsenseRequested && !publisherId) {
  configIssues.push({
    level: 'error',
    provider: 'google_adsense',
    code: 'PUBLISHER_ID_MISSING',
    message: 'GOOGLE_ADSENSE_ENABLED is true but GOOGLE_ADSENSE_PUBLISHER_ID is not set; the provider is treated as disabled.',
  });
}

const enabledPlacements = listPlacements({ enabledOnly: true });

if (adsenseEnabled && enabledPlacements.length && Object.keys(adUnitParse.units).length === 0) {
  configIssues.push({
    level: 'warn',
    provider: 'google_adsense',
    code: 'NO_AD_UNITS',
    message: 'Google AdSense is enabled but no ad units are configured; placements will get a publisher id with no slot.',
  });
}

/** Public provider configuration. Publisher ids and ad-unit slots are page-level identifiers. */
export const advertisingConfig = () => ({
  version: ADVERTISING_CONFIG_VERSION,
  providers: {
    testflow: {
      id: 'testflow',
      label: 'Testflow Ads',
      kind: 'internal',
      enabled: testflowEnabled,
      configured: testflowEnabled,
    },
    google_adsense: {
      id: 'google_adsense',
      label: 'Google AdSense',
      kind: 'external',
      enabled: adsenseEnabled,
      requested: adsenseRequested,
      configured: !!publisherId,
      publisherId,
      adUnits: { ...adUnitParse.units },
      requireConsent: config.GOOGLE_ADSENSE_REQUIRE_CONSENT === 'true',
      reporting: {
        enabled: config.GOOGLE_ADSENSE_REPORTING_ENABLED === 'true',
        configured: false,
        status: config.GOOGLE_ADSENSE_REPORTING_ENABLED === 'true' ? 'not_configured' : 'disabled',
      },
    },
  },
  placements: listPlacements(),
  issues: configIssues,
});

/** The two provider switches, as the eligibility service reads them. */
export const providerAvailability = () => ({
  testflow: { enabled: testflowEnabled },
  google_adsense: {
    enabled: adsenseEnabled,
    publisherId,
    requireConsent: config.GOOGLE_ADSENSE_REQUIRE_CONSENT === 'true',
  },
});

export const configIssuesList = () => [...configIssues];
