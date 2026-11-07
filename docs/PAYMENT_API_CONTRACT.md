# Payment API Contract — Native Paystack Bank Transfer for TestFlow Subscriptions

Date: 2026-11-06  
Repository: `/workspace/testflow-backend`

This contract covers **all subscription payment products** that use Paystack in the backend, with native bank transfer as the default checkout method.

## Subscription product inventory (audited)

| Product | Plans | Backend surface | Payment record | Activation target |
|---|---|---|---|---|
| **Individual student subscriptions** (Student Pass / Plus) | `pass_30d` (**Plus**, available), `pass_90d` (Pro tier in student catalog, currently `comingSoon/unavailable` unless enabled by settings) — all plans resolved server-side from `src/config/plans.js` / `findStudentPlan` | `/api/billing/ad-free/*` (`billing.routes.js`, `billing.controller.js`, `studentPurchase.service.js`) | `StudentPurchase` (`TFS-...` refs) | `StudentEntitlement` grants (`ad_free`, `live_cbt_host`, `library`, `ai_early_access`, `custom_cbt`) per plan snapshot; renewals/purchases extend from live expiry (`grantEntitlement`) |
| **TestFlow for Everyone organisation subscriptions** | `pro`, `studio` (from `PlanDefinition`) | `/api/v1/everybody/.../subscriptions/*`, `/api/v1/everybody/subscriptions/:id/upgrade|renew`, `/api/v1/everybody/payments/verify`, `/api/v1/everybody/subscriptions/webhook` | `SubscriptionPayment` (`SUB-...` refs) | `Subscription` activation/snapshot/period extension; upgrades prorated, downgrades scheduled |

**Not subscription payments (unchanged):** one-time student exam payments (`OrgPayment`, `/api/v1/public/exams/:examId/checkout`, `/api/v1/public/payments/*`), org payout/subaccount/bank resolution, ad campaign checkouts (`/api/ads/checkout*`).

## Shared payment principles

- **Server-authoritative pricing**: plan key/catalog/PlanDefinition determines amount; client never supplies price.
- **Default method**: `paystack_bank_transfer` for all supported subscription checkouts (student plans + org plans), initialized with Paystack `channels: ["bank_transfer"]` where supported.
- **No fake instructions**: transfer details are normalized only from provider-returned fields (`normalizePaystackTransferInstructions` / adapter normalization). Missing fields are omitted/null.
- **No activation on client claim**: “I have paid” never activates subscriptions/entitlements. Activation only after **provider-confirmed success** (verify/fetch/webhook) with amount/currency/reference/ownership/product checks.
- **Idempotent & recoverable**: idempotency keys/body+header support, webhook event dedupe, safe status refresh, checkout recovery by reference; refresh/recovery **never** create duplicate provider transactions.
- **Security**: webhook HMAC-SHA512 over raw bytes (`x-paystack-signature`), ownership checks (student can only access own purchases; org owner/admin only for org payments), amount/currency/reference/org/user association validation.

## Normalized payment semantics (frontend-facing)

`status` remains backward-compatible on stored models; `paymentState`/response state can be interpreted consistently:

| Normalized state | Typical meaning |
|---|---|
| `initializing` | checkout created/redirect path being prepared (legacy checkout) |
| `awaiting_transfer` | native bank transfer initialized; show transfer instructions and poll/refresh |
| `processing` | provider confirmation pending/being verified (transient client interpretation) |
| `success` / `paid` | provider-confirmed and settled |
| `failed` | provider failed, mismatch, or unrecoverable failure |
| `expired` / `abandoned` | transfer/payment window expired or abandoned per existing product rules |

Student purchases expose `paymentState` (`initializing|awaiting_transfer|...|expired` mapping where applicable). Org responses expose `status`/`payment.status` plus `paymentMethod`/transfer instructions.

## 1) Individual student subscriptions (Plus and all student plans)

Base: `/api/billing` (authenticated unless noted). Raw webhook body captured for `/api/billing/ad-free/webhook`.

### 1.1 List plans
`GET /api/billing/ad-free/products` (public)
- Returns server-priced available/coming-soon plan catalog (`pass_30d` Plus, `pass_90d`, etc. as configured).

### 1.2 Start / recover checkout
`POST /api/billing/ad-free/checkout` (student, rate-limited)
Headers: `Idempotency-Key` optional. Body:
```json
{ "planKey": "pass_30d", "idempotencyKey": "optional-string", "paymentMethod": "paystack_bank_transfer" }
```
- `paymentMethod` default: `paystack_bank_transfer`.
- Response `201` new / `200` replay:
```json
{
  "purchase": {
    "id": "...",
    "reference": "TFS-...",
    "planKey": "pass_30d",
    "planName": "Plus",
    "amountKobo": 50000,
    "currency": "NGN",
    "status": "initialized",
    "paymentState": "awaiting_transfer",
    "provider": "paystack",
    "paymentMethod": "paystack_bank_transfer",
    "authorizationUrl": null,
    "transferInstructions": {
      "bankName": "…", "accountName": "…", "accountNumber": "…",
      "amountKobo": 50000, "currency": "NGN", "expiresAt": "…",
      "transferReference": "…", "displayText": "…", "channel": "…"
    },
    "paidAt": null, "verifiedAt": null, "createdAt": "…"
  }
}
```
- Legacy `paystack_checkout` may return `authorizationUrl`; native transfer returns instructions, usually no redirect.

### 1.3 Status / refresh (safe poll)
`GET /api/billing/ad-free/status?reference=TFS-...&refresh=true` (student)
- `refresh` default true. For initialized purchases, re-verifies provider and persists any newly available transfer instructions; **no duplicate transaction**.
- Ownership enforced. Returns `{ entitlement, purchase }`.

### 1.4 Checkout recovery (no new init)
`GET /api/billing/ad-free/checkout-status?reference=TFS-...` (student)
- Returns stored purchase/transfer instructions for the owning student. Never initializes provider.

### 1.5 Cancel pending purchase
`POST /api/billing/ad-free/cancel` with `{ "reference": "TFS-..." }` (owning student). Paid purchases require admin refund flow.

### 1.6 Webhook
`POST /api/billing/ad-free/webhook` (public, Paystack server-to-server)
- Verifies `x-paystack-signature` over raw bytes. Handles `TFS-` references (ignores others).
- Re-verifies with provider before granting; checks amount/currency/reference/user association; idempotent event handling.
- `refund.processed` revokes entitlements granted by that purchase (existing behavior).

### 1.7 Lifecycle notes
- Entitlements are granted/extended by `grantEntitlement` using plan `durationDays` and snapshot entitlement keys; purchasing while live extends from current expiry (stacking), enabling renewal/repurchase behavior.
- Upgrades between student passes are represented by purchasing the target plan (server-priced, provider-confirmed); entitlement duration stacks per existing grant logic. Any product-specific upgrade UI should use checkout+verify and display resulting expiry/entitlements.

## 2) TestFlow for Everyone organisation subscriptions (Pro/Studio)

Base: `/api/v1/everybody` (authenticated). Raw webhook body captured for `/api/v1/everybody/subscriptions/webhook`.

### 2.1 Start / recover org subscription checkout
`POST /api/v1/everybody/organizations/:organizationId/subscriptions/:id/checkout`
Auth: owner/admin. Header: `Idempotency-Key` optional.
```json
{ "paymentMethod": "paystack_bank_transfer" }
```
- Default native bank transfer, server-priced from subscription/PlanDefinition.
- Response `201` new / `200` idempotent recovery includes `reference` (`SUB-...`), `amountKobo`, `currency`, `paymentMethod`, `status`, `transferInstructions`, `payment`, and `authorizationUrl` only for legacy checkout compatibility.

### 2.2 Upgrade / schedule downgrade
`POST /api/v1/everybody/subscriptions/:id/upgrade`
Body: `{ "planKey": "pro|studio|free", "paymentMethod": "paystack_bank_transfer" }`, `Idempotency-Key` optional.
- Upgrade: prorated server-calculated checkout (default bank transfer), activation only after provider confirmation.
- Downgrade: returns `200 {}` scheduled for period end, no charge.

### 2.3 Renew
`POST /api/v1/everybody/subscriptions/:id/renew`
Optional `paymentMethod` (default bank transfer), `Idempotency-Key` supported. Paid days stack only after provider-confirmed settlement.

### 2.4 Recovery / status
- `GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/checkout-status?reference=SUB-...` — owner/admin, no new init.
- `GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/payment-status?reference=SUB-...&refresh=true` — safe refresh; persists new transfer instructions when available.
- `GET /api/v1/everybody/organizations/:organizationId/subscriptions/:id/verify?reference=...`
- `GET /api/v1/everybody/payments/verify?reference=...` (flat; membership checked on payment)

### 2.5 Webhook
`POST /api/v1/everybody/subscriptions/webhook` (public)
- HMAC verified over raw bytes. Amount/currency/reference/org/subscription association checked before activation.
- `charge.success` settles idempotently; `charge.failed`/refund events handled safely; duplicate deliveries/event ids deduped.

## 3) Transfer instructions schema (common shape)

Fields are provider-dependent; expose only what Paystack returns:
```json
{
  "bankName": "string|null",
  "accountName": "string|null",
  "accountNumber": "string|null",
  "amountKobo": 0,
  "currency": "NGN",
  "expiresAt": "ISO-8601|null",
  "transferReference": "string|null",
  "displayText": "string|null",
  "channel": "bank_transfer|null"
}
```

## 4) Paystack account/configuration notes (must verify)

- Paystack “Pay with Transfer” / bank transfer availability and exact response fields can vary by merchant account, country/currency, and channel enablement.
- Some integrations expose transfer account details on initialize/charge responses; others may require fetch/verify to observe status/details. This implementation **does not fabricate** details and persists any details returned by initialize/verify/webhook/fetch.
- If a merchant account is not enabled for the required transfer flow, initialize may fail with a provider error (`502 PAYMENT_INIT_FAILED` / provider message). Frontend should surface the error and ops must confirm Paystack dashboard/channel enablement in test mode before production.

## 5) Frontend endpoint map

| Flow | Start checkout | Recover checkout | Status/refresh | Verify | Webhook (server) |
|---|---|---|---|---|---|
| Student Plus/all student plans | `POST /api/billing/ad-free/checkout` | `GET /api/billing/ad-free/checkout-status?reference=` | `GET /api/billing/ad-free/status?reference=&refresh=` | use status with reference | `POST /api/billing/ad-free/webhook` |
| Org Pro/Studio | `POST /api/v1/everybody/organizations/:orgId/subscriptions/:id/checkout` or upgrade/renew endpoints | `GET .../subscriptions/:id/checkout-status?reference=` | `GET .../subscriptions/:id/payment-status?reference=&refresh=` | `GET .../verify?reference=` or `/api/v1/everybody/payments/verify?reference=` | `POST /api/v1/everybody/subscriptions/webhook` |

All money values are integer **kobo** (`amountKobo`).

## Central Paystack webhook (recommended)

Paystack dashboard is typically configured with one webhook URL per environment. The backend now provides a central dispatcher:

- **Preferred endpoint:** `POST /api/webhooks/paystack` (full deployed URL: `https://<PUBLIC_API_BASE_URL>/api/webhooks/paystack`)
- **Signature:** `x-paystack-signature` header, HMAC-SHA512 over the exact raw request body using the configured Paystack secret key (as implemented/verified in this codebase). Signature is verified before dispatch; unsigned/invalid signatures are rejected.
- **Raw body:** captured for `/api/webhooks/paystack` in `src/app.js`.
- **Dispatch:** `TFS-*` references => existing student purchase webhook logic; `SUB-*` references => existing organisation subscription webhook logic. No settlement logic duplicated.
- **Safety:** preserves amount/currency/reference/ownership/provider verification checks, idempotent dedupe, and safe handling for unknown references/unsupported events. Processing failures return errors (not successful settlement acknowledgements).
- **Legacy endpoints (backward compatible):** `POST /api/billing/ad-free/webhook` (student), `POST /api/v1/everybody/subscriptions/webhook` (org), and other product-specific webhooks remain in place. Configure Paystack dashboard to `/api/webhooks/paystack` for consolidated student/org subscription handling.

