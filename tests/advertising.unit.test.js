/**
 * Advertising eligibility and placement registry. No database: every case here is a guest, and a
 * guest needs no session lookup.
 *
 * The two provider switches are set before anything is imported, because configuration is read once
 * at module load. Google is ON and Testflow is OFF here, which is the case the product must survive:
 * a Google outage or switch-off never takes Testflow Ads down, and the reverse holds too.
 */
process.env.NODE_ENV = 'test';
process.env.ADS_JOBS_ENABLED = 'false';
process.env.GOOGLE_ADSENSE_ENABLED = 'true';
process.env.GOOGLE_ADSENSE_PUBLISHER_ID = 'ca-pub-1234567890123456';
process.env.GOOGLE_ADSENSE_REQUIRE_CONSENT = 'true';
process.env.GOOGLE_ADSENSE_AD_UNITS = 'content_feed:1234567890,desktop_sidebar:not-a-number,nope:1234567890,newslot';
process.env.ADVERTISING_TESTFLOW_ENABLED = 'false';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('Advertising eligibility (unit)', () => {
  let evaluateEligibility; let advertisingConfig; let resolvePlacement;
  let isEntitlementLive; let PLACEMENT_IDS;

  before(async () => {
    ({ evaluateEligibility } = await import('../src/services/advertising/eligibility.service.js'));
    ({ advertisingConfig, resolvePlacement, PLACEMENT_IDS } = await import('../src/config/advertising.js'));
    ({ isEntitlementLive } = await import('../src/models/StudentEntitlement.js'));
  });

  it('reports Google configured and Testflow switched off, independently', () => {
    const config = advertisingConfig();
    assert.equal(config.providers.google_adsense.enabled, true);
    assert.equal(config.providers.google_adsense.publisherId, 'ca-pub-1234567890123456');
    assert.equal(config.providers.testflow.enabled, false);
  });

  it('accepts only well-formed ad units and says what it dropped', () => {
    const config = advertisingConfig();
    assert.deepEqual(config.providers.google_adsense.adUnits, { content_feed: '1234567890' });
    const codes = config.issues.map((i) => i.code).sort();
    assert.deepEqual(codes, ['AD_UNIT_INVALID_SLOT', 'AD_UNIT_MALFORMED', 'AD_UNIT_UNKNOWN_PLACEMENT']);
    assert.ok(config.issues.every((i) => i.level === 'warn'), 'a dropped ad unit is a warning, not a failure');
  });

  it('never fabricates a placement: only registry ids exist', async () => {
    assert.ok(PLACEMENT_IDS.includes('content_feed'));
    assert.equal(resolvePlacement('made_up_placement'), null);
    await assert.rejects(
      () => evaluateEligibility({ placement: 'made_up_placement' }),
      (err) => err.statusCode === 404 && err.code === 'PLACEMENT_NOT_FOUND',
    );
  });

  it('keeps examinations, live rooms, checkout and auth out of advertising for good', async () => {
    for (const id of ['exam_session', 'live_cbt', 'payment_checkout', 'auth']) {
      const placement = resolvePlacement(id);
      assert.equal(placement.sensitive, true);
      assert.equal(placement.enabled, false);

      const result = await evaluateEligibility({ placement: id, consent: 'granted' });
      assert.equal(result.adsEnabled, false, `${id} must never serve`);
      assert.equal(result.reason, 'PLACEMENT_RESTRICTED');
      assert.equal(result.providers.testflow.eligible, false);
      assert.equal(result.providers.google_adsense.eligible, false);
    }
  });

  it('keeps content placements eligible', () => {
    assert.equal(resolvePlacement('content_feed').enabled, true);
    assert.equal(resolvePlacement('desktop_sidebar').enabled, true);
    assert.equal(resolvePlacement('post_activity').enabled, true);
  });

  it('a switched-off provider is ineligible and the other one keeps working', async () => {
    const result = await evaluateEligibility({ placement: 'content_feed', consent: 'granted' });
    assert.equal(result.providers.testflow.eligible, false);
    assert.equal(result.providers.testflow.reason, 'PROVIDER_DISABLED');
    assert.equal(result.providers.google_adsense.eligible, true);
    assert.equal(result.adsEnabled, true);
    assert.equal(result.reason, null);
  });

  it('holds personalized Google ads until consent is asserted, and never invents it', async () => {
    const silent = await evaluateEligibility({ placement: 'content_feed' });
    assert.equal(silent.providers.google_adsense.eligible, false);
    assert.equal(silent.providers.google_adsense.reason, 'CONSENT_REQUIRED');
    assert.equal(silent.consent, 'unknown');
    assert.equal(silent.adsEnabled, false);

    const granted = await evaluateEligibility({ placement: 'content_feed', consent: 'granted' });
    assert.equal(granted.providers.google_adsense.eligible, true);
  });

  it('always honours a refusal, whichever provider it is', async () => {
    const result = await evaluateEligibility({ placement: 'content_feed', consent: 'denied' });
    assert.equal(result.providers.testflow.eligible, false);
    assert.equal(result.providers.google_adsense.eligible, false);
    assert.equal(result.providers.google_adsense.reason, 'CONSENT_WITHHELD');
    assert.equal(result.adsEnabled, false);
    assert.equal(result.reason, 'CONSENT_WITHHELD');
  });

  it('an unknown consent value is treated as no consent at all', async () => {
    const result = await evaluateEligibility({ placement: 'content_feed', consent: 'please-serve-me-ads' });
    assert.equal(result.consent, 'unknown');
    assert.equal(result.providers.google_adsense.eligible, false);
  });

  it('an unexpired entitlement is live; an expired, revoked or inactive one is not', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    assert.equal(isEntitlementLive({ active: true, expired: false, expiresAt: null }, now), true);
    assert.equal(isEntitlementLive({ active: true, expiresAt: new Date('2026-06-01T00:00:00Z') }, now), true);
    assert.equal(isEntitlementLive({ active: true, expiresAt: new Date('2025-12-31T00:00:00Z') }, now), false);
    assert.equal(isEntitlementLive({ active: false, expiresAt: null }, now), false);
    assert.equal(isEntitlementLive({ active: true, expiresAt: null, revokedAt: now }, now), false);
    assert.equal(isEntitlementLive(null, now), false);
  });
});
