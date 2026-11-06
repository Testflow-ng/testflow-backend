# Payment Implementation Status — Subscription Native Bank Transfer

Date: 2026-11-06  
Repository: `/workspace/testflow-backend`

## Implemented (backend)

### Paystack adapter (`src/services/orgPaystack.service.js`)
- `initializeOrgTransaction` accepts optional `channels` (e.g. `['bank_transfer']`) and no longer requires `callback_url` when absent.
- Normalizes provider responses defensively via `normalizePaystackTransferInstructions` (maps only provider-returned fields; no fabrication).
- `verifyOrgTransaction`/`fetchOrgTransaction` return normalized status/amount/currency/channel/transaction id and transfer instructions when present.
- `parseOrgWebhook` includes transfer/channel/amount/currency metadata where available.
- Backward-compatible for existing callers (student exam payments still pass `callbackUrl`/`subaccount`).

### Subscription payment model (`src/models/SubscriptionPayment.js`)
- Added `paymentMethod` (`paystack_checkout|paystack_bank_transfer`, default checkout field with service defaulting to bank transfer), `transferInstructions` subdocument, `providerTransactionId`, `providerChannel`.
- Preserved existing statuses/indexes/idempotency behavior.

### Subscription service (`src/services/orgSubscription.service.js`)
- `startCheckout` defaults to **native bank transfer** (`channels:['bank_transfer']`), persists transfer instructions/authorization URL/channel, and is idempotent by `Idempotency-Key` and existing payment state.
- Added `startSubscriptionCheckout` for explicit org-scoped checkout.
- `upgradeSubscription`/`renewSubscription` accept optional `paymentMethod` (default bank transfer).
- Added `getSubscriptionPaymentStatus` (safe refresh/poll; persists newly available instructions; no duplicate init) and `getCheckoutByReference` (recovery only).
- `verifySubscriptionPayment` uses provider-confirmed refresh/settlement path.
- `handleSubscriptionWebhook` verifies signature, dedupes event ids, persists transfer metadata, validates amount/currency, settles only on `charge.success`, and ignores/handles non-success safely.

### Controllers/routes (`src/controllers/organization.controller.js`, `src/routes/everybody.subscription.routes.js`)
- Replaced legacy `checkout` handler that fabricated `SUB-<id>` references/local URLs with service-backed provider checkout.
- Replaced legacy local-only `verify` activation with provider-confirmed verification.
- Added endpoints:
  - `GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/payment-status?reference=&refresh=`
  - `GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/checkout-status?reference=`
- Upgrade/renew accept `Idempotency-Key`/`paymentMethod`; create-audit action updated to `SUBSCRIPTION_CHECKOUT_STARTED`.

### OpenAPI (`docs/openapi.js`)
- Documented bank-transfer default checkout, recovery/status endpoints, upgrade/renew `paymentMethod`/idempotency, and `SubscriptionPaymentView`/`SubscriptionTransferInstructions`/updated `CheckoutResponse`/`SubscriptionVerification` schemas.

### Tests (`tests/orgSubscriptionPayments.integration.test.js`)
- Updated mock Paystack provider to return bank-transfer instructions when `channels` includes `bank_transfer` and to support `fetch`.
- Kept existing legacy checkout assertion by explicitly requesting `paymentMethod:'paystack_checkout'` in that case.
- Added integration test for default bank-transfer upgrade: returns transfer instructions, idempotent reuse with same key, checkout-status recovery, payment-status (no refresh), and provider-confirmed verify activates Pro. **Requires `MONGODB_URI_TEST` (disposable DB); not executed in this environment.**

## Preserved / unchanged behavior

- Student paid-exam tenant payments (`src/services/orgStudentPayments.service.js`, `OrgPayment`, `/api/v1/public/payments/*`) still initialize with `callbackUrl` + organizer `subaccount`; Paystack adapter remains compatible.
- Org payout/subaccount/bank resolution APIs unchanged.
- Webhook raw-body capture and CSRF exemption for subscription webhook remain in `src/app.js`.
- Entitlement/plan snapshot/proration/downgrade scheduling logic preserved.

## Gaps / follow-ups

1. **Paystack bank-transfer response shape variability**: normalization is defensive and only maps fields present. If Paystack returns instructions only after a follow-up fetch/verify in some account/channel configurations, status refresh persists them; create-path may return instructions only when present on initialize response. Validate against enabled Paystack account/test credentials.
2. **Legacy compatibility**: `POST .../checkout` previously returned a fabricated local URL/reference in some code paths; now it returns real service-backed payment state. Frontend must consume `paymentMethod`/`transferInstructions`/status endpoints.
3. **Abandoned/expired mapping**: provider statuses mapped conservatively; explicit expiry/abandonment polling policy can be tightened after confirming provider fields/events.
4. **DB migration/backfill**: existing `SubscriptionPayment` documents remain valid; `paymentMethod` defaults apply logically in views/service where needed.
5. **No real provider/DNS/TLS testing performed** in this environment.
