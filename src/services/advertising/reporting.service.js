import { config } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { StudentEntitlement } from '../../models/StudentEntitlement.js';
import { StudentPurchase } from '../../models/StudentPurchase.js';
import { advertisingConfig, configIssuesList, listPlacements } from '../../config/advertising.js';

/**
 * Google AdSense publisher reporting (AdSense Management API) — integration point only.
 *
 * Why it is not implemented: reporting needs OAuth credentials for the AdSense account, which do
 * not exist yet, and nothing in the product consumes publisher revenue yet. Reporting must also
 * never sit on the ad-serving path: the frontend renders Google's units itself, so a reporting
 * outage cannot blank an ad or touch Testflow Ads.
 *
 * What this module guarantees today:
 *  - `/api/advertising/admin/health` reports the integration as disabled/not_configured, with a
 *    machine-readable reason, instead of pretending to have numbers.
 *  - `fetchPublisherReport()` refuses with 501 until credentials are wired, so no caller can treat
 *    an empty result as "zero revenue".
 *  - When the credentials land: implement `fetchPublisherReport` against
 *    `GET https://adsense.googleapis.com/v2/accounts/{account}/reports:generate` using a
 *    service-account or OAuth refresh token read from the environment, cache the response
 *    (`storedAt` + `expiresAt`), and never convert Google's publisher revenue into a Testflow
 *    advertiser amount.
 */

const REPORTING_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';

export const reportingStatus = () => ({
  provider: 'adsense_management_api',
  enabled: config.GOOGLE_ADSENSE_REPORTING_ENABLED === 'true',
  configured: false, // no credentials in this release
  status: config.GOOGLE_ADSENSE_REPORTING_ENABLED === 'true' ? 'not_configured' : 'disabled',
  scope: REPORTING_SCOPE,
  lastSyncAt: null,
  lastError: null,
  note: 'Publisher metrics come from Google, never from frontend render events. Not enabled in this release.',
});

/** Refuses loudly rather than returning an empty-but-successful result. */
export const fetchPublisherReport = async () => {
  throw new AppError(501, 'REPORTING_NOT_CONFIGURED', 'Google AdSense reporting is not configured in this release.');
};

/** Aggregated operational counts for the admin health view. Never per-user data. */
export const advertisingHealth = async ({ now = new Date() } = {}) => {
  const live = { active: true, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
  const [adFree, liveCbtHost, paidPurchases, pendingPurchases] = await Promise.all([
    StudentEntitlement.countDocuments({ key: 'ad_free', ...live }),
    StudentEntitlement.countDocuments({ key: 'live_cbt_host', ...live }),
    StudentPurchase.countDocuments({ status: 'paid' }),
    StudentPurchase.countDocuments({ status: 'initialized' }),
  ]);

  const { providers } = advertisingConfig();
  const enabled = listPlacements({ enabledOnly: true });

  return {
    providers: {
      testflow: { enabled: providers.testflow.enabled },
      google_adsense: {
        enabled: providers.google_adsense.enabled,
        requested: providers.google_adsense.requested,
        configured: providers.google_adsense.configured,
        requireConsent: providers.google_adsense.requireConsent,
      },
    },
    placements: { registered: listPlacements().length, enabled: enabled.length, enabledIds: enabled.map((p) => p.id) },
    entitlements: { adFree, liveCbtHost },
    purchases: { paid: paidPurchases, pending: pendingPurchases },
    reporting: reportingStatus(),
    issues: configIssuesList(),
    checkedAt: now.toISOString(),
  };
};
