import { AppError } from '../../utils/AppError.js';
import {
  AD_FREE_SUPPRESSED_PROVIDERS,
  AD_PROVIDERS,
  ADVERTISING_CONFIG_VERSION,
  providerAvailability,
  resolvePlacement,
} from '../../config/advertising.js';
import { studentEntitlements } from '../studentPlan.service.js';

/**
 * The single place that answers "may this user see an ad here, and from which provider".
 *
 * What it does NOT do: it never claims inventory. `eligible: true` means the provider is permitted,
 * not that Google returned a creative. Fill is the frontend's (and Google's) business. The backend
 * supplies eligibility, configuration and entitlement; the client renders the unit.
 *
 * Reasons are a closed set so a client can switch on them without string matching a sentence.
 */
export const ELIGIBILITY_REASONS = Object.freeze([
  'PLACEMENT_RESTRICTED', // registered, but sensitive or switched off
  'PLACEMENT_PROVIDER_UNSUPPORTED',
  'AD_FREE_ENTITLEMENT', // the user paid to remove this provider
  'CONSENT_WITHHELD', // the user refused; respected even without a paid plan
  'CONSENT_REQUIRED', // personalized ads need an affirmative signal we do not have
  'PROVIDER_DISABLED', // switched off by configuration
  'AUTH_REQUIRED', // the provider needs a signed-in student
  'ELIGIBLE',
]);

/**
 * Consent is only ever enforced negatively or on an explicit affirmative assertion:
 *
 *  - `denied`  — always honoured, for every provider, paid plan or not.
 *  - `granted` — taken as the caller's assertion. It is NOT proof of consent: a real
 *                consent-management platform owns that decision. It only matters when
 *                `GOOGLE_ADSENSE_REQUIRE_CONSENT` is on, in which case the absence of an
 *                assertion is treated as "no consent" and personalized ads stay off.
 *  - `unknown` — no assertion.
 */
const normalizeConsent = (consent) => (['granted', 'denied', 'unknown'].includes(consent) ? consent : 'unknown');

const decideProvider = ({ provider, placement, capability, entitlements, authenticated, consent }) => {
  const eligible = () => ({ eligible: true, reason: 'ELIGIBLE' });
  const blocked = (reason) => ({ eligible: false, reason });

  if (!placement.enabled) return blocked('PLACEMENT_RESTRICTED');
  if (!placement.providers.includes(provider)) return blocked('PLACEMENT_PROVIDER_UNSUPPORTED');
  if (AD_FREE_SUPPRESSED_PROVIDERS.includes(provider) && entitlements?.adFree) return blocked('AD_FREE_ENTITLEMENT');
  if (consent === 'denied') return blocked('CONSENT_WITHHELD');
  if (!capability.enabled) return blocked('PROVIDER_DISABLED');

  if (provider === 'testflow') {
    // Testflow Ads are billed to advertisers per student impression and served to student
    // memberships, so they need a signed-in student.
    if (!authenticated) return blocked('AUTH_REQUIRED');
    return eligible();
  }

  if (provider === 'google_adsense') {
    // Anonymous readers of a public page are the publisher's normal audience: Google's tag
    // works without a session. Nothing personal is passed to it from here.
    if (capability.requireConsent && consent !== 'granted') return blocked('CONSENT_REQUIRED');
    return eligible();
  }

  return blocked('PROVIDER_DISABLED');
};

/**
 * @param {object}   input
 * @param {object}   input.user        the authenticated student, or null (guest)
 * @param {string}   input.placement   a registry id
 * @param {string}   input.consent     'granted' | 'denied' | 'unknown'
 * @param {Date}     input.now
 * @throws {AppError} 404 PLACEMENT_NOT_FOUND for an unregistered placement
 */
export const evaluateEligibility = async ({ user = null, placement: placementId, consent = 'unknown', now = new Date() }) => {
  const placement = resolvePlacement(placementId);
  if (!placement) {
    throw new AppError(404, 'PLACEMENT_NOT_FOUND', 'That advertising placement is not registered.');
  }

  const availability = providerAvailability();
  const normalizedConsent = normalizeConsent(consent);
  const entitlements = user ? await studentEntitlements(user._id, { now }) : null;

  const providers = {};
  for (const provider of AD_PROVIDERS) {
    providers[provider] = decideProvider({
      provider,
      placement,
      capability: availability[provider],
      entitlements,
      authenticated: !!user,
      consent: normalizedConsent,
    });
  }

  const eligibleProviders = AD_PROVIDERS.filter((p) => providers[p].eligible);
  const firstBlocked = AD_PROVIDERS.map((p) => providers[p]).find((p) => !p.eligible);

  return {
    placement: placement.id,
    service: placement.contexts,
    placementKnown: true,
    placementEnabled: placement.enabled,
    authenticated: !!user,
    consent: normalizedConsent,
    adFree: !!entitlements?.adFree,
    entitlementStatus: entitlements?.status ?? 'free',
    providers,
    adsEnabled: eligibleProviders.length > 0,
    // When nothing may serve, say why once so a client has one field to read.
    reason: eligibleProviders.length ? null : firstBlocked?.reason ?? 'PLACEMENT_RESTRICTED',
    configVersion: ADVERTISING_CONFIG_VERSION,
    checkedAt: now.toISOString(),
  };
};

export default evaluateEligibility;
