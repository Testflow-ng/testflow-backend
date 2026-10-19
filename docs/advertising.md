# Advertising providers, ad-free entitlement, and the student pass

This document covers the Google AdSense infrastructure, the advertisement placement registry, the
ad-free entitlement, and the student pass that also unlocks Live CBT hosting.

It does **not** cover the Testflow Ads marketplace (advertiser campaigns, targeting, creative
moderation, advertiser billing, impression accounting). That system lives in `src/services/ads/**`
and `src/routes/ads.routes.js` and was deliberately left untouched by this work.

## 1. The two providers are separate systems

| | `testflow` | `google_adsense` |
|---|---|---|
| Kind | Internal marketplace | Google publisher product |
| Testflow creates the ads | Yes | No |
| Testflow bills for the ads | Yes (advertiser, per impression) | No (Google pays the publisher) |
| Impressions counted by | `models/AdImpression` / serving service | Google, client-side |
| Backend role | Serves and bills | Only decides whether a placement may carry a unit |

They share no campaign records, no billing code, and no impression counters. The only thing they
share is the eligibility service, which treats them as two independent boolean decisions.

Two environment flags switch them independently:

* `ADVERTISING_TESTFLOW_ENABLED` (default `true`)
* `GOOGLE_ADSENSE_ENABLED` (default `false`)

A Google misconfiguration can never disable Testflow Ads, and a Testflow Ads problem can never
disable Google.

## 2. Where the code lives

```
src/config/advertising.js                     provider flags, placement registry, ad units, config validation
src/config/plans.js                           the student plan catalogue (prices live here)
src/models/StudentEntitlement.js              one row per (student, entitlement)
src/models/StudentPurchase.js                 one-time purchase / audit record
src/services/advertising/eligibility.service.js   the only place that decides who may see an ad
src/services/advertising/reporting.service.js     AdSense Management API integration point (not enabled)
src/services/studentPlan.service.js           entitlement read / grant / revoke / expiry
src/services/studentPurchase.service.js       checkout, verification, webhook, refund
src/controllers/advertising.controller.js     src/routes/advertising.routes.js
src/controllers/billing.controller.js         src/routes/billing.routes.js
src/validators/advertising.schema.js
src/middleware/optionalAuth.js                guest-or-student endpoints
tests/advertising.unit.test.js                10 tests, no database
tests/advertising.integration.test.js         13 tests
tests/entitlements.integration.test.js        19 tests
```

The payment provider is the project's existing one: `src/services/ads/payment` (Paystack adapter,
`getProvider()` / `setProviderForTests()`). No second payment integration was added.

## 3. Configuration

Everything deployment-specific is an environment variable. Nothing about a provider's keys is stored
in the database, because none of it changes per user.

| Variable | Default | Purpose |
|---|---|---|
| `ADVERTISING_TESTFLOW_ENABLED` | `true` | Offer Testflow Ads as a provider |
| `GOOGLE_ADSENSE_ENABLED` | `false` | Offer Google AdSense as a provider |
| `GOOGLE_ADSENSE_PUBLISHER_ID` | unset | `ca-pub-...`. A public identifier, not a credential |
| `GOOGLE_ADSENSE_AD_UNITS` | unset | `placement:slotId` pairs, comma separated |
| `GOOGLE_ADSENSE_REQUIRE_CONSENT` | `false` | Require an affirmative consent signal (EEA/UK) |
| `GOOGLE_ADSENSE_REPORTING_ENABLED` | `false` | AdSense Management API reporting |
| `ADVERTISING_PLACEMENTS_ENABLED` | unset | Authoritative allow list; unset = registry defaults |
| `ADVERTISING_PLACEMENTS_DISABLED` | unset | Deny list, applied on top of the allow list |
| `AD_FREE_CALLBACK_URL` | `<CLIENT_URL>/billing/complete` | Where Paystack returns the student |

Validation is fail-safe and visible: if `GOOGLE_ADSENSE_ENABLED=true` but the publisher id is missing,
Google is reported and treated as **disabled** (never half-configured), and the reason is returned
with the config. Malformed ad-unit entries are dropped and reported. Both appear in
`GET /api/advertising/config` (`issues`) and in the admin health endpoint.

No secret is ever returned to a client. The publisher id and ad-unit slots are returned because they
are page-level identifiers that ship in the HTML anyway.

## 4. The placement registry

Placements are the only place an ad may appear. Ads are never injected into a page automatically.

| Placement | Default | Sensitive | Contexts |
|---|---|---|---|
| `content_feed` | enabled | no | question list, library |
| `desktop_sidebar` | enabled (desktop only) | no | question list, library |
| `post_activity` | enabled | no | exam session result, Post-UTME result |
| `exam_session` | disabled | **yes** | examination in progress |
| `live_cbt` | disabled | **yes** | live CBT room |
| `payment_checkout` | disabled | **yes** | billing |
| `auth` | disabled | **yes** | authentication forms |

Rules:

* An id that is not in the registry does not exist: `404 PLACEMENT_NOT_FOUND`.
* A placement serves only if it is `enabled` **and** not `sensitive` **and** permitted by the allow
  list **and** not on the deny list.
* `sensitive` wins over every allow list, so exams, live rooms, checkout and auth screens can never
  be switched on by configuration.
* A new placement added to the registry defaults to `enabled: false`.

To approve a new placement: add it to `PLACEMENTS` in `src/config/advertising.js` with
`enabled: true`, set `providers`, then either leave the allow list unset or add the id to
`ADVERTISING_PLACEMENTS_ENABLED`.

## 5. Eligibility

`GET /api/advertising/eligibility?placement=content_feed&consent=unknown`

The endpoint is optional-auth: a guest gets the anonymous policy, a signed-in student gets theirs.

```json
{
  "placement": "content_feed",
  "placementKnown": true,
  "placementEnabled": true,
  "authenticated": true,
  "consent": "unknown",
  "adFree": false,
  "entitlementStatus": "free",
  "providers": {
    "testflow":       { "eligible": true,  "reason": "ELIGIBLE" },
    "google_adsense": { "eligible": true,  "reason": "ELIGIBLE" }
  },
  "adsEnabled": true,
  "reason": null,
  "configVersion": 1,
  "checkedAt": "2026-01-01T00:00:00.000Z"
}
```

`eligible: true` means **the provider is permitted**, not that Google returned a creative. The
backend never claims fill, never invents inventory, and never treats a frontend render event as a
billable impression. The client renders the unit; Google reports on it.

Reason codes (closed set): `PLACEMENT_RESTRICTED`, `PLACEMENT_PROVIDER_UNSUPPORTED`,
`AD_FREE_ENTITLEMENT`, `CONSENT_WITHHELD`, `CONSENT_REQUIRED`, `PROVIDER_DISABLED`, `AUTH_REQUIRED`,
`ELIGIBLE`.

Decision order: placement, then ad-free entitlement, then consent, then provider flag, then
authentication.

Documented anonymous policy: a guest is eligible for Google AdSense on an approved content placement
(public pages are the publisher's normal audience) and **not** for Testflow Ads, which are billed to
advertisers per student impression and served to student memberships. A guest with a paid pass
cannot exist by definition.

### Consent

Consent is handled negatively, because a backend boolean is not proof of consent:

* `denied` is always honoured, for every provider, paid plan or not. This is the privacy preference
  the backend can act on with confidence.
* `granted` is treated as the caller's assertion, not as verified consent. A real consent-management
  platform owns that decision. It only matters when `GOOGLE_ADSENSE_REQUIRE_CONSENT` is on; without
  an assertion (or with an unrecognized value) Google personalized ads stay off.
* Ad eligibility and ad-free entitlement are separate questions: a user may hold a paid pass and
  still have privacy preferences that must be respected.

If a CMP is introduced later, the integration point is the `consent` input on the eligibility
endpoint: have the server derive it from the stored consent record instead of from a query string.

## 6. The ad-free entitlement and the student pass

`StudentEntitlement` holds one row per (student, key), with `key` in `ad_free | live_cbt_host`.
Liveness is computed against the clock (`active`, no `revokedAt`, `expiresAt` in the future), so an
expired pass stops working immediately without a job having to run. `expireLapsedEntitlements()` is
available for housekeeping and is purely cosmetic.

Scope, stated explicitly and asserted in tests:

* `ad_free` suppresses **both** providers (`testflow` and `google_adsense`) across the student
  product.
* `live_cbt_host` suppresses nothing. It only unlocks hosting a live CBT session.

### Live CBT: hosting is paid, joining is free

`liveCbt.service.createExam` requires the `live_cbt_host` entitlement and otherwise fails with
`402 PLAN_REQUIRED`. Joining a room (`POST /api/live-cbt/:code/join`), answering, submitting and
reading results are unchanged and need no plan.

The gate lives in the service, not the router, so every future caller passes through it.

### Products

The catalogue is `src/config/plans.js` (code, like the Everybody `PLAN_SEED`, so a price change is a
deployment):

| Key | Price | Duration | Grants |
|---|---|---|---|
| `pass_30d` | ₦2,500 | 30 days | `ad_free`, `live_cbt_host` |
| `pass_90d` | ₦6,000 | 90 days | `ad_free`, `live_cbt_host` |

**Assumption to confirm:** those two price points are placeholders. They are the only numbers in this
slice that are not derived from the existing codebase.

There is no student recurring billing, and none was invented: a pass is a one-time purchase with an
explicit duration. Renewing mid-pass extends from the current expiry rather than resetting it.

## 7. Payment flow

1. `POST /api/billing/ad-free/checkout` with `{ planKey, idempotencyKey? }`.
2. The backend prices the plan from the catalogue (a client-supplied `priceMinor` is rejected), writes
   an `initialized` `StudentPurchase`, and initializes with Paystack.
3. The student pays on Paystack's page.
4. Paystack calls `POST /api/billing/ad-free/webhook` and/or the client polls
   `GET /api/billing/ad-free/status?reference=`.
5. The backend verifies the HMAC over the raw bytes, then **re-verifies the transaction with the
   provider**. It never trusts the webhook amount.
6. Reference, amount, currency, status and owner are checked. A mismatch marks the purchase `failed`
   and grants nothing (`409 PAYMENT_MISMATCH`).
7. On success the entitlements are granted once. A redelivered event is a no-op
   (`{ "duplicate": true }`) and does not extend the pass.
8. Refunds reverse with the provider and revoke exactly what that purchase granted. A later pass that
   stacked on top keeps its entitlement.

Reference prefix `TFS-`. A webhook for another prefix (for example a subscription's) is acknowledged
and ignored, so the dispatchers do not fight over one Paystack endpoint.

Webhook authentication is the signature; the endpoint is in the CSRF skip list and keeps the raw body
for HMAC verification.

## 8. Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/advertising/config` | public | Provider switches, ad units, placements, config issues |
| GET | `/api/advertising/placements` | public | The registry and each placement's effective state |
| GET | `/api/advertising/placements/:id` | public | One placement (`404` if unregistered) |
| GET | `/api/advertising/eligibility` | optional | The contract above |
| GET | `/api/advertising/admin/health` | admin | Provider status, placement counts, entitlement counts, issues |
| GET | `/api/advertising/admin/reporting` | admin | Reporting integration status |
| GET | `/api/billing/ad-free/products` | public | The plan catalogue |
| GET | `/api/billing/entitlement` | student | What the caller holds (including `liveCbtHost`) |
| POST | `/api/billing/ad-free/checkout` | student, rate limited | Start a purchase |
| GET | `/api/billing/ad-free/status` | student | Entitlement, and optionally re-verify one purchase |
| POST | `/api/billing/ad-free/cancel` | student | Abandon one's own pending purchase |
| POST | `/api/billing/ad-free/refund` | admin | Refund and revoke |
| POST | `/api/billing/ad-free/entitlements/:userId/grant` | admin | Grant by hand (support) |
| POST | `/api/billing/ad-free/entitlements/:userId/revoke` | admin | Revoke by hand (support) |
| POST | `/api/billing/ad-free/webhook` | provider | Paystack |

The task brief suggested a `/api/ads/...` namespace. That prefix belongs to the Testflow Ads
marketplace, which this slice must not touch, so the new surface is `/api/advertising` and
`/api/billing`. A student cannot change their own entitlement through any of these: the only
student-facing write is a checkout, and entitlement changes only ever follow a verified payment or an
administrator action.

## 9. Database

Two new collections, created by Mongoose on startup (`init()`), no destructive migration:

* `studententitlements`: unique `{ user, key }`, plus `{ key, active, expiresAt }`.
* `studentpurchases`: unique `reference`, unique sparse `{ user, idempotencyKey }`, plus
  `{ user, createdAt }` and `{ status, createdAt }`.

One additive change to an existing collection: `AuditLog.action` gains
`AD_FREE_PURCHASE_VERIFIED`, `AD_FREE_REFUND`, `ENTITLEMENT_GRANT`, `ENTITLEMENT_REVOKE`, and
`AuditLog.targetType` gains `StudentPurchase`, `StudentEntitlement`.

No Testflow Ads collection, field or index was modified. Google publisher revenue is never stored as
if it were money collected from a Testflow advertiser; when reporting is implemented it gets its own
provider-scoped storage.

## 10. Tests

```
node --test tests/advertising.unit.test.js                                          # 10, no database
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/tf_advertising_test \
  node --test --test-force-exit tests/advertising.integration.test.js               # 13
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/tf_entitlements_test \
  node --test --test-force-exit tests/entitlements.integration.test.js              # 19
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/tf_live_test \
  node --test --test-force-exit tests/liveCbt.integration.test.js                   # 6, includes the new gate
```

Covered: free student eligible for both providers; a paid pass suppressing both; a live-CBT-only grant
suppressing neither; an expired pass restoring eligibility; Google disabled while Testflow Ads stay
available, and the reverse; restricted and sensitive placements never serving; unknown placements
`404`; guest policy; consent withheld and consent required; unauthenticated and unauthorized
requests; a student unable to modify an entitlement; rate-limited checkout; verified, failed,
pending, mismatched and duplicate payments; cancelled and refunded purchases; entitlement expiry; and
the isolation of a Google reporting failure from both eligibility and Testflow Ads.

Existing Testflow Ads suites were re-run unchanged: `ads.unit` 45/45, `ads.integration` 16/19 (the 3
failures are the pre-existing ones, identical before and after this work).

## 11. Operational readiness

* **Structured logging**: configuration problems are reported in the API responses above; provider
  initialize and verification failures are logged through `utils/logger.js`. No per-user ad data is
  logged.
* **Metrics and health**: `GET /api/advertising/admin/health`. Aggregated counts only, never
  per-student data.
* **Safe failure**: Google off or misconfigured degrades to "no Google ads", never a 5xx on a page
  load, and never affects Testflow Ads. Reporting failures are independent of eligibility and serving.
* **Privacy**: no raw advertising identifiers, browsing history or personal data are stored. The
  purchase metadata sent to Paystack is the product, the plan and the user id.

## 12. Google-side checklist (outside the codebase)

1. Create or access the AdSense account and complete payment/tax details.
2. Add and **get the site approved** (`testflow.com.ng`). Ads will not serve before approval.
3. Copy the publisher id into `GOOGLE_ADSENSE_PUBLISHER_ID` and set `GOOGLE_ADSENSE_ENABLED=true`.
4. Create ad units in AdSense and map them into `GOOGLE_ADSENSE_AD_UNITS` (`placement:slotId`).
5. Publish `ads.txt` at the site root containing the publisher id. Not part of this slice.
6. If serving EEA/UK traffic, choose a Google-certified CMP, wire it to the frontend, and set
   `GOOGLE_ADSENSE_REQUIRE_CONSENT=true`.
7. Optionally create a service account or OAuth refresh token before enabling reporting.

## 13. Remaining frontend work

The backend supplies eligibility, configuration and entitlement. The frontend still has to:

* Read `GET /api/advertising/config` and `GET /api/advertising/eligibility` before rendering.
* Load Google's tag and render ad units for the placements marked eligible. Nothing is rendered by
  the backend.
* Send the consent signal (or stop asserting consent) once a CMP exists.
* Add a plan/purchase surface using `/api/billing/ad-free/products` and `/api/billing/ad-free/checkout`,
  plus the `/billing/complete` return route (or set `AD_FREE_CALLBACK_URL`).
* Show the "hosting needs a plan" state when `POST /api/live-cbt` answers `402 PLAN_REQUIRED`, using
  `GET /api/billing/entitlement` to decide whether to offer the button at all.

## 14. Known limitations and future enhancements

* **Publisher reporting is not implemented.** `fetchPublisherReport()` deliberately refuses with
  `501 REPORTING_NOT_CONFIGURED` rather than returning an empty result that could be mistaken for no
  revenue. The OAuth/Management API integration point is documented in
  `src/services/advertising/reporting.service.js`.
* **`ads.txt` is not served** by the backend.
* **Chargebacks** are handled through the refund path (an operator action). Automated
  dispute-webhook handling is not implemented.
* **Publisher id per placement**: one publisher id for the whole deployment. A per-placement publisher
  would be a small extension to `GOOGLE_ADSENSE_AD_UNITS`.
* **No server-side ad auction** is created, and no unsupported Google ad-serving API is called, by
  design.

## 15. Readiness stages

Do not collapse these into one:

1. **Backend implementation: complete** (this document).
2. **Google AdSense account and site approval: not started.** Nothing can serve without it.
3. **Frontend ad-unit integration: not started** (section 13).
4. **Payment integration: code complete**, exercised against a fake provider in tests. Not yet run
   against live Paystack keys; the existing adapter notes it has never been called against the live
   API.
5. **Production verification: not started.**

Adding backend code does not make advertisements serve.
