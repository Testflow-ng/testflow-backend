# Payment API Contract — Subscription Native Bank Transfer (Backend)

Date: 2026-11-06  
Scope: **organization subscription payments** (`/api/v1/everybody/*subscriptions*`, `/api/v1/everybody/payments/verify`, `/api/v1/everybody/subscriptions/webhook`) in `/workspace/testflow-backend`.  
Out of scope: student paid-exam/tenant payments (`/api/v1/public/exams/:examId/checkout`, `/api/v1/public/payments/verify`, `/api/v1/public/payments/webhook`) and `OrgPayment` flows — **unchanged** except shared Paystack adapter remains backward-compatible.

## 1. Design goals

- Replace Paystack **checkout redirect** as the default for **subscription payments** with **native Paystack bank transfer** (“Pay with Transfer” / bank transfer channel).
- Persist pending payment state and provider-returned transfer instructions so refresh/status recovery does **not** create duplicate pending transactions.
- Never activate a subscription on a client “I have paid” claim. Activation occurs **only** after provider-confirmed success (verify or webhook) with amount/currency/reference/org checks and idempotent settlement.
- Keep student paid-exam payment flows intact.

## 2. Payment model (subscription)

`SubscriptionPayment` (`src/models/SubscriptionPayment.js`):

| Field | Type | Notes |
|---|---|---|
| `reference` | string, unique | `SUB-...` server-generated reference |
| `organization` | ObjectId | owning org |
| `subscription` | ObjectId | target subscription |
| `kind` | `new\|renewal\|upgrade` | payment intent |
| `planKey` | `pro\|studio` | paid plan |
| `amountKobo` | number | server-priced (PlanDefinition/snapshot/proration) |
| `currency` | string | default `NGN` |
| `status` | `initialized\|paid\|failed\|abandoned\|refunded` | normalized |
| `provider` | `paystack\|none` | |
| `paymentMethod` | `paystack_checkout\|paystack_bank_transfer` | **default `paystack_bank_transfer`** for subscription payments |
| `authorizationUrl` | string? | legacy checkout compatibility only |
| `transferInstructions` | object? | normalized provider instructions (see below); **only fields returned by provider** |
| `providerTransactionId` | string? | provider transaction id when available |
| `providerChannel` | string? | provider channel when available |
| `idempotencyKey` | string? | partial unique index per org; omitted when absent |
| `paidAt`, `verifiedAt` | date? | settlement timestamps |
| `processedEventIds` | string[] | webhook dedupe |

### Transfer instructions (normalized, defensive)

```json
{
  "bankName": "string|null",
  "accountName": "string|null",
  "accountNumber": "string|null",
  "amountKobo": 700000,
  "currency": "NGN",
  "expiresAt": "ISO-8601|null",
  "transferReference": "string|null",
  "displayText": "string|null",
  "channel": "string|null"
}
```

Fields are mapped only from provider data (`normalizePaystackTransferInstructions` in `src/services/orgPaystack.service.js`). Missing fields are omitted/null; **backend does not fabricate account details**.

## 3. Endpoints

All authenticated endpoints enforce owner/admin membership via existing org/subscription guards. Flat verify checks membership on the payment’s organization.

### 3.1 Start / recover checkout (org-scoped)
`POST /api/v1/everybody/organizations/:organizationId/subscriptions/:id/checkout`  
Auth: owner/admin. CSRF: yes (cookie auth).  
Headers: `Idempotency-Key` optional (recommended).

Request body (optional):
```json
{ "paymentMethod": "paystack_bank_transfer" }
```
`paymentMethod`: `paystack_bank_transfer` (default) | `paystack_checkout` (explicit legacy compatibility).

Response `201` (new pending payment) / `200` (idempotent recovery):
```json
{
  "paymentId": "...",
  "reference": "SUB-...",
  "amountKobo": 700000,
  "currency": "NGN",
  "authorizationUrl": null,
  "paymentMethod": "paystack_bank_transfer",
  "status": "initialized",
  "reused": false,
  "transferInstructions": { "...normalized..." },
  "payment": { "...SubscriptionPaymentView..." }
}
```

Behavior:
- Server prices from `PlanDefinition`/subscription snapshot rules (no client price).
- Default initializes Paystack with `channels: ["bank_transfer"]` and persists returned instructions.
- Reusing `Idempotency-Key` returns the existing payment (**no duplicate provider init**).
- Legacy `paystack_checkout` may return `authorizationUrl`; student exam payments still use checkout redirect.

Errors: `404 NOT_FOUND`, `422 PLAN_UNAVAILABLE` (free plan), `503 PAYMENT_NOT_CONFIGURED`, provider init mapped to `502 PAYMENT_INIT_FAILED` and marks payment failed.

### 3.2 Upgrade / schedule downgrade
`POST /api/v1/everybody/subscriptions/:id/upgrade` (flat; resolves org from sub)  
Auth: owner/admin. `Idempotency-Key` optional.

Body:
```json
{ "planKey": "pro|studio|free", "paymentMethod": "paystack_bank_transfer" }
```
- Upgrade: prorated difference, returns checkout/payment object (default bank transfer).
- Downgrade/noop: returns `200 {}` (scheduled/unchanged), no charge.
- `paymentMethod` defaults to `paystack_bank_transfer`.

### 3.3 Renew
`POST /api/v1/everybody/subscriptions/:id/renew` (flat)  
Auth: owner/admin. `Idempotency-Key` optional. Body may include `paymentMethod` (default bank transfer).  
Returns checkout/payment object; paid period stacks only after provider-confirmed settlement.

### 3.4 Checkout recovery by reference (no new init)
`GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/checkout-status?reference=SUB-...`  
Auth: owner/admin, org-scoped. Returns existing checkout/payment state + transfer instructions. **Never creates a provider transaction.**

### 3.5 Payment status / refresh
`GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/payment-status?reference=SUB-...&refresh=true`  
Auth: owner/admin, org-scoped.

- `refresh` default `true`: for `initialized` payments, re-checks Paystack verify/fetch and persists newly available transfer instructions; **no duplicate transaction creation**.
- Returns:
```json
{
  "status": "paid|pending|failed|abandoned|refunded",
  "duplicate": false,
  "refreshed": true,
  "providerStatus": "string|null",
  "payment": { "...SubscriptionPaymentView..." },
  "subscription": { "...subView..." }
}
```
- `pending`/missing success is **not completion**. Do not activate on this alone except through verified provider success path (service handles settlement).

### 3.6 Verify (org-scoped) / flat verify
`GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/verify?reference=...`  
`GET /api/v1/everybody/payments/verify?reference=...` (flat; membership checked on payment)

Both refresh/verify through provider for pending payments and settle only on confirmed success with amount/currency/reference/org checks. Idempotent (`duplicate` possible). Response includes `payment`, `subscription`, `entitlements` (where applicable).

### 3.7 Webhook
`POST /api/v1/everybody/subscriptions/webhook`  
Public, CSRF-exempt, raw-body captured (`src/app.js`), `x-paystack-signature` HMAC-SHA512 required.

Behavior:
- Verifies signature over exact raw bytes.
- Ignores unknown references/events safely.
- Dedupes by provider event id where present.
- Persists provider transfer/channel metadata without activating.
- `charge.success`: validates amount/currency against stored payment and settles idempotently.
- `charge.failed`: marks initialized payment failed.
- `refund.*`: marks paid payment refunded.
- **No activation on non-success or client claims.**

## 4. Security / correctness

- Server-authoritative amount/currency/plan pricing and proration.
- Ownership checks on every payment read/status/verify path.
- Amount/currency/reference/org validation before activation.
- Idempotent settlement and webhook dedupe; no duplicate subscription extension.
- No secrets exposed in API responses.
- Student paid-exam checkout/verify/webhook (`OrgPayment`, tenant routes) unchanged.

## 5. Migration / compatibility notes

- Existing subscription payments default `paymentMethod` to `paystack_checkout`/derived in views when absent; schema supports old records.
- Legacy controller checkout that fabricated local references/URLs was removed in favor of service-backed provider flow.
- Frontend may opt into legacy redirect with `paymentMethod:"paystack_checkout"` only if explicitly needed; default is bank transfer.
