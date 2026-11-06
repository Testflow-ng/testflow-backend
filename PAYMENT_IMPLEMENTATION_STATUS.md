# Payment Implementation Status — Native Bank Transfer for All Subscription Products

Date: 2026-11-06  
Repository: `/workspace/testflow-backend`

## Audited subscription inventory

1. **Individual student subscriptions** (`src/config/plans.js`, `StudentPurchase`, `StudentEntitlement`, `studentPurchase.service.js`, `/api/billing/ad-free/*`)
   - Available now: **Plus** (`pass_30d`, ₦500/50000 kobo, 30 days) — entitlements include `ad_free`, `live_cbt_host`, `library`, `ai_early_access`, `custom_cbt`.
   - Catalog also contains `pass_90d` (currently `available:false`, `comingSoon:true` by default; can be overridden via settings cache). Implementation supports **all server-available student plan keys** from `findStudentPlan`/catalog, not hard-coded to one plan.
   - Existing lifecycle: one-time pass purchase grants/extends entitlements; `grantEntitlement` extends from current live expiry (renewal/repurchase stacking). Admin grant/revoke/refund paths preserved.
2. **TestFlow for Everyone organisation subscriptions** (`PlanDefinition`, `Subscription`, `SubscriptionPayment`, `orgSubscription.service.js`, `/api/v1/everybody/*subscriptions*`)
   - Plans: **Pro** and **Studio** (server-priced from PlanDefinition/snapshots), plus scheduled downgrade/free handling per existing lifecycle.
   - Existing lifecycle: prorated upgrades, renewals, webhook/verify settlement, scheduled downgrades/enforcement.
3. **Other Paystack subscription-like checkouts audited**
   - **Ad campaign checkout** (`src/services/ads/payment.service.js`, `/api/ads/checkout*`) uses shared `getProvider().initialize` and expects `authorizationUrl`; left on checkout redirect behavior (not a user/org subscription product). Shared Paystack adapter remains backward-compatible.
   - **One-time student exam payments** (`OrgPayment`, `orgStudentPayments.service.js`, `/api/v1/public/*`) unchanged.

## Implemented

### Shared Paystack compatibility
- `src/services/ads/payment/paystack.js` (shared `getProvider`/Paystack provider used by student billing and ads checkout): accepts optional `channels`, optional callback URL, returns `reference/accessCode/raw`; `verify` returns normalized status/amount/currency/transaction/channel/raw; added `fetch`. **Backward-compatible** for existing ad checkout callers expecting `authorizationUrl`.
- `src/services/orgPaystack.service.js`: bank-transfer channel support, defensive transfer-instruction normalization (provider-returned fields only), `fetchOrgTransaction`, richer webhook parse/normalization.

### Student subscriptions (Plus/all available student plans)
- `src/models/StudentPurchase.js`: added `paymentMethod` (`paystack_checkout|paystack_bank_transfer`), `transferInstructions`, `providerChannel`.
- `src/services/studentPurchase.service.js`: default `paymentMethod=paystack_bank_transfer` for `startCheckout`; sends `channels:['bank_transfer']`; persists transfer instructions/channel/transaction metadata; idempotent replay by `idempotencyKey`; `getStatus(..., refresh)` safely re-verifies initialized purchases and persists newly available instructions without creating duplicates; `getPurchaseByReference` recovery (no new init); `toPurchaseView` exposes `paymentMethod`, `paymentState`, `transferInstructions`; `applyVerifiedPayment` remains provider-confirmed, amount/currency checked, idempotent for paid purchases.
- `src/controllers/billing.controller.js` / `src/routes/billing.routes.js` / `src/validators/advertising.schema.js`: accept `paymentMethod` and `Idempotency-Key`; added `GET /api/billing/ad-free/checkout-status?reference=`; status supports `refresh`.
- `src/app.js` already captured raw body and exempted CSRF flow context for `/api/billing/ad-free/webhook` (unchanged).
- Webhook behavior remains HMAC raw-body verified, `TFS-` reference scoped, provider re-verification before grant, amount/currency checks, event claim/idempotent handling, refund revoke path preserved.

### Organisation subscriptions (Pro/Studio)
- `src/models/SubscriptionPayment.js`: `paymentMethod`, `transferInstructions`, `providerTransactionId`, `providerChannel`.
- `src/services/orgSubscription.service.js`: default bank-transfer init, idempotent checkout/upgrade/renew, checkout recovery, payment status refresh, provider-confirmed verify, hardened webhook settlement/dedupe/metadata persistence.
- `src/controllers/organization.controller.js` / `src/routes/everybody.subscription.routes.js`: service-backed checkout/verify/status/recovery endpoints; removed legacy fabricated local checkout/activation behavior.
- Webhook raw-body capture/CSRF exemption already present in `src/app.js`.

### API/docs/tests
- `docs/openapi.js`: updated student billing + org subscription contracts for bank-transfer default, transfer instructions, recovery/status, payment method, and semantics.
- `tests/orgSubscriptionPayments.integration.test.js`: updated for bank-transfer default/compat and added idempotent recovery/status case (DB-gated; not runtime-executed here).
- Existing `tests/entitlements.integration.test.js` student billing flows remain structurally compatible (uses shared provider test hook; assertions not rewritten for UI fields except no breaking contract changes intended) — **not runtime-executed here**.

## Preserved / intentionally unchanged

- One-time **student exam payments** (`OrgPayment`, tenant checkout/verify/webhook) — unchanged.
- Org **payout/subaccount/bank resolution/split** logic — unchanged.
- Ad campaign checkout/payment lifecycle — unchanged contract; shared Paystack adapter keeps `authorizationUrl` behavior.
- Server-authoritative pricing, no frontend activation, webhook signature verification, ownership checks, idempotent settlement principles.

## Gaps / account-config / operational blockers

1. **Paystack merchant/channel enablement**: native transfer/Pay-with-Transfer behavior and returned fields vary by account configuration/country/channel. Ops must confirm the Paystack test/live account supports required bank-transfer flow and observe actual response fields.
2. **Runtime validation not completed** in this environment: `node_modules` missing; no disposable `MONGODB_URI_TEST`; no Paystack test-mode credentials/live webhooks. Integration tests and real transfer settlement must be run before production.
3. **Student checkout endpoint naming**: existing path remains `/api/billing/ad-free/checkout` for backward compatibility; semantics now cover Plus/all student plans with bank transfer default. Frontend can use same endpoint + new `paymentMethod/paymentState/transferInstructions` fields.
4. **Ad checkout still redirect-oriented**: if ads should also move to native transfer, that requires separate product/UX/test work (not done; not a subscription product in this task).
5. **Transfer expiry enforcement**: provider expiry is persisted when returned; explicit expiry state transitions/polling policy can be tightened after confirming Paystack payloads/events.
