# TestFlow Ads Manager — backend reference

Stack reused (no new infra): Node 22 ESM · Express 4 · MongoDB/Mongoose · zod · JWT httpOnly cookies
(`tf_access`/`tf_refresh`) · roles `student|advertiser|admin|super_admin` · `AuditLog` · Cloudflare R2 for files.
Only new runtime dependency: `sharp` (image decoding/optimizing). Routes live under the existing `/api` prefix (the project has no version prefix).

## Decisions
- **Advertiser = new `advertiser` role** on the existing `User` (same login/cookies/refresh/logout). Email is unique across all roles, so an advertiser needs an email not already used by a student.
- Cookies are shared if `COOKIE_DOMAIN=.testflow.com.ng`; one browser holds one session at a time (student *or* advertiser).
- Money is integer **kobo**. Default fee `100000` (₦1,000/day), admin-configurable.
- **No Mongo transactions** (works on standalone Mongo): every state change is an atomic, status-guarded `findOneAndUpdate`.
- No queue exists → in-process scheduler with a Mongo lease lock (`JobLock`), safe with several instances.
- No payment provider existed → `PaymentProvider` interface + a Paystack adapter (needs `PAYSTACK_SECRET_KEY`; **not exercised against the live API yet**).
- ImageKit removed; storage is Cloudflare R2 through a small SigV4 client (`src/utils/r2.js`, verified against AWS's test vector).

## Collections
| Model | Purpose / key indexes |
|---|---|
| `AdSettings` | singleton: fee, pricing policy/tiers, limits, retention days, frequency caps, terms version |
| `AdvertiserProfile` | `user` unique, businessName, phone |
| `AdAsset` | optimized image; `storageKey` (R2), `attachedAt`; index `(attachedAt, createdAt)` |
| `Campaign` | content, destination, keywords≤3, status machine, price snapshot, timestamps, `purgeAt`, `stats`; indexes `(advertiser,status,createdAt)`, `(status,startsAt,endsAt)`, `(status,submittedAt)`, `image`, `purgeAt` |
| `AdPayment` | checkout: unique `reference`, items[], amount, status, provider; unique `(advertiser,idempotencyKey)` |
| `CampaignModeration` | append-only history `(campaign,createdAt)` |
| `AdServe` | one served ad per session (unique `sessionKey`); HMAC `studentKey`; TTL 2 days |
| `AdEvent` | deduped events; unique `eventId`, unique `(serveId,type)` |
| `AdViewer` | unique `(campaign,viewerHash)` for unique-viewer counting |
| `AdDailyStat` | per-campaign UTC-day rollup; unique `(campaign,day)` — analytics read this |
| `JobLock`, `JobRun` | lease locks; run log (90-day TTL) |

## Campaign state machine (`src/utils/ads/campaignState.js`)
```
draft → pending_payment → pending_review → active | scheduled → expired → archived
                 ↘ draft (checkout cancelled/failed)    ↘ rejected → pending_review (resubmit, no repay) | archived
active|scheduled → suspended → active|scheduled      active|scheduled|suspended → removed → archived
```
`approved` is not a resting state: approval atomically sets `active` (start ≤ now) or `scheduled`. Only a verified payment moves `pending_payment→pending_review`; only an admin moves `pending_review→active/scheduled`. Paid period = `durationDays × 24h` from `startsAt` (approval time, or the advertiser's preferred start date). Suspension does not extend the period. Expired campaigns are never revived — **republish** clones into a new draft that must be paid and approved again.

## Pricing & payment
`total = dailyFee × days`; policy `tiered` applies the best `minDays→percentOff` tier. Always server-side; checkout bodies are strict, so a client price is rejected. Terms: checkout requires `acceptTerms:true` and the current `termsVersion` (stored on each campaign with time + IP).
Flow: `POST /ads/checkout` claims campaigns `draft→pending_payment` (atomic; concurrent checkouts → one 201, rest 409), creates an `AdPayment`, calls the provider. Completion arrives by **signed webhook** (HMAC-SHA512 over the raw body) and/or `GET /ads/checkout/verify`; in both cases the server **re-verifies with the provider API**, checks amount + currency, then wins a single atomic `status != paid → paid` claim (duplicates are no-ops). A reconciler (every minute) re-verifies stale checkouts, abandons unpaid ones after 2h, and repairs "paid but campaign still pending_payment" after a crash.

## Metrics (precise definitions)
- **eligibleRequests** – times the ad was selected and returned to a student after a *completed* CBT session.
- **impression** – client reports the ad rendered ≥50% visible for ≥1000 ms (`visibleMs`, server-enforced minimum 1000); at most one per served ad.
- **uniqueViewers** – distinct students per campaign (HMAC(student,campaign); unlinkable across campaigns).
- **click** – first "open/view ad" click per served ad (requires a prior impression). **whatsappClick** – first WhatsApp-contact tap per served ad (WhatsApp campaigns only). **skip** – student dismissed.
- **ctr** = clicks ÷ impressions %, **whatsappCtr** = whatsappClicks ÷ impressions %. **spend** = campaign price once payment is verified.
Dedupe: `eventId` UUID idempotency key + unique `(serveId,type)`. Advertisers only ever see aggregates; students are stored only as keyed hashes (serve rows expire after 2 days).

## Serving algorithm (`deterministic-v1`, `src/utils/ads/ranker.js`)
Eligible = `status ∈ {active,scheduled}` ∧ paid ∧ `startsAt ≤ now < endsAt` ∧ not past `purgeAt` (checked **at request time**, independent of the worker) ∧ ads enabled ∧ not over frequency caps (`maxAdsPerStudentPerDay`, `maxSameCampaignPerStudentPerDay`, rolling 24h). Rank: keyword relevance to the session's subject/department → fewest impressions today → ending soonest → id. One ad per session (reload returns the same ad). The ranker is a pure function; a future model replaces `rank()` without changing the API (`ranker` is echoed in responses).

## Retention (exact behaviour)
- On expiry the worker sets `expiredAt = endsAt` and `purgeAt = endsAt + retentionDays` (default 7). Admin **removal** sets `purgeAt = removedAt + retentionDays`; a reject-with-refund sets `purgeAt` likewise. **Rejected** campaigns get `purgeAt = rejectedAt + rejectedRetentionDays` (default 30); resubmitting clears it.
- Until `purgeAt`: visible to advertiser (final analytics, republish). From `purgeAt`: **hidden from advertiser and admin lists/details at query time** even if the job is late.
- Job `ads-retention` (hourly, lease-locked, logged to `JobRun`, each step retried 3× with backoff, idempotent). Per campaign, in this order: claim → delete `AdEvent`, `AdViewer`, `AdServe`, `AdDailyStat`, `CampaignModeration` → anonymize payment line items (drop campaign name, set `campaignPurgedAt`; **amounts, references, timestamps kept**) → delete the R2 image + `AdAsset` **only if no other campaign references it** → delete the campaign → audit entry `AD_CAMPAIGN_PURGED` (id only). A failure leaves the campaign in place for the next run.
- Also: unattached/unreferenced assets older than 24h deleted; abandoned checkouts older than 30 days deleted. Paid/failed-with-reason payments and `AuditLog` are **never** purged by this job (financial/fraud retention; define the statutory period with your accountant).
- Not covered: abandoned **drafts** have no purge date (they are unpaid, private to the advertiser, and hold no analytics).

## Endpoints (all JSON; errors `{error:{code,message,fields?}}`; lists `?page&limit` → `{items,page,limit,total}`)
**Auth/profile** (cookie auth shared with `/api/auth/*`: login, logout, refresh also work for advertisers)
| | | Auth | Notes |
|---|---|---|---|
| POST | `/api/ads/auth/register` | public, 20/15min | `{fullName,email,password,confirmPassword,businessName,contactPhone?}` → 201 `{user,profile}` + cookies; 409 `EMAIL_TAKEN` |
| POST | `/api/ads/auth/login` | public | `{email,password}`; 403 `NOT_AN_ADVERTISER` |
| GET | `/api/ads/auth/me` | advertiser | user + profile |
| PATCH | `/api/ads/profile` | advertiser | `{fullName?,businessName?,contactPhone?}` |

**Pricing/settings (public)**: `GET /api/ads/pricing` → public limits, fee, terms version & URLs.

**Assets**: `POST /api/ads/assets/images` (advertiser, multipart field `image`, ≤2 MB, 40/h) → 201 `{asset:{id,url,width,height,bytes,format}}`; 413 `IMAGE_TOO_LARGE`, 422 `INVALID_IMAGE|UNSUPPORTED_IMAGE_FORMAT|IMAGE_TOO_SMALL|ANIMATED_IMAGE_NOT_ALLOWED`. `DELETE /api/ads/assets/:id` (409 if used).

**Campaigns** (advertiser; every query is scoped by `advertiser = me`, foreign ids → 404)
| | | |
|---|---|---|
| GET | `/api/ads/dashboard` | counts per group + totals |
| GET | `/api/ads/campaigns?group=active\|pending_review\|pending_payment\|draft\|rejected\|suspended\|expired\|archived&status&q` | default hides archived |
| POST | `/api/ads/campaigns` | `{name,title,description,assetId,destination:{type:'url',url}\|{type:'whatsapp',whatsapp},keywords[≤3],durationDays,preferredStartDate?}` → 201 draft with server price |
| GET | `/api/ads/campaigns/:id` | campaign + history + remainingMs |
| PATCH | `/api/ads/campaigns/:id` | draft/rejected only; paid duration locked |
| DELETE | `/api/ads/campaigns/:id` | unpaid draft only |
| POST | `/api/ads/campaigns/:id/resubmit` | rejected(paid) → pending_review |
| POST | `/api/ads/campaigns/:id/archive` | expired/removed/rejected |
| POST | `/api/ads/campaigns/:id/republish` | expired/removed → new draft (idempotent) |
| GET | `/api/ads/campaigns/:id/analytics?from&to` | totals, ctr, spend, daily series (≤92 days) |

**Checkout/payments**
| | | |
|---|---|---|
| POST | `/api/ads/checkout/quote` | `{campaignIds}` → server prices |
| POST | `/api/ads/checkout` | `{campaignIds,acceptTerms:true,termsVersion}` + optional `Idempotency-Key` → 201 `{paymentId,reference,amountKobo,authorizationUrl,items}`; 409 `TERMS_VERSION_MISMATCH\|NOT_PAYABLE\|CHECKOUT_CONFLICT`; 503 `PAYMENT_NOT_CONFIGURED` |
| GET | `/api/ads/checkout/verify?reference=` | owner-only; re-verifies with provider |
| POST | `/api/ads/checkout/:id/cancel` | unpaid only; releases campaigns to draft |
| GET | `/api/ads/payments` | my payment history |
| POST | `/api/ads/payments/webhook` | public; header `x-paystack-signature`; 401 on bad signature, 200 otherwise |

**Admin** (`authorize('admin')` → admin + super_admin; mounted at `/api/admin/ads`; actions audited in `AuditLog`)
`GET /overview` · `GET /campaigns?status&group&paymentStatus&advertiser&q` (review queue oldest-first) · `GET /campaigns/:id` (advertiser, payment, content, history) · `GET /campaigns/:id/history` · `GET /campaigns/:id/analytics` · `POST /campaigns/:id/approve` · `POST /campaigns/:id/reject {reason≥5,refund?}` · `POST …/suspend {reason}` · `POST …/reinstate` · `POST …/remove {reason}` · `GET /payments?status&advertiser` · `POST /payments/:id/refund {reason}` (whole payment; only when its campaigns were rejected *with refund*; single-shot, audited, calls the provider's refund API) · `GET|PATCH /settings` · `GET /jobs` (job run log).

**Student serving** (existing student auth)
- `POST /api/ads/serve` `{sessionType:'exam'|'post_utme', sessionId}` → `{ad:{serveId,label:'Sponsored',title,description,imageUrl,cta:{type,label,href}}, ranker}` or `{ad:null, reason:'no_eligible_campaign'|'frequency_capped'|'ads_disabled'}`. 409 `SESSION_NOT_COMPLETED`, 404 for another student's session.
- `POST /api/ads/events` `{serveId,eventId(uuid),type:'impression'|'click'|'whatsapp_click'|'skip',visibleMs?}` → `{accepted,duplicate,redirectUrl}`; 409 `IMPRESSION_REQUIRED`, 422 `IMPRESSION_CRITERIA_NOT_MET`, 410 `SERVE_EXPIRED`.

**Ops**: `GET /health` (existing); `GET /api/admin/ads/jobs`. Jobs: `ads-lifecycle` every 1 min (activate due, expire due, repair paid, reconcile payments), `ads-retention` hourly. Disable with `ADS_JOBS_ENABLED=false`.

## Config
`ADS_CLIENT_URL` (CORS; leave empty while the ads site lives at `testflow.com.ng/ads`, because it is the same origin as `CLIENT_URL`), `PAYMENT_PROVIDER`, `PAYSTACK_SECRET_KEY`, `ADS_PAYMENT_CALLBACK_URL`, `ADS_EVENT_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.

## Link safety, refunds, rate limits
- **Links:** https-only, no IPs/localhost/credentials/odd ports, and **link shorteners are refused**. If `GOOGLE_SAFE_BROWSING_KEY` is set, each destination is checked against Google Safe Browsing (flagged → 422; lookup errors fail open and are logged — admins still review every link).
- **Refunds:** reject with `refund:true` → campaign `paymentStatus=refund_due`; admin calls `POST /api/admin/ads/payments/:id/refund`. Status path `paid → refunding → refunded` (provider failure reverts to `paid`). A late webhook can never resurrect a refunded payment. Refund provider call is implemented for Paystack but **not yet exercised live**.
- **Rate limits:** auth, image upload and checkout use a MongoDB-backed fixed window (`RateLimitHit`, TTL) so limits hold across all instances. The high-volume student `serve`/`events` routes use a cheap per-process limiter on purpose (the real abuse controls there are session ownership, frequency caps and event dedupe).

## Financial record retention (agreed policy)
Payment records (`AdPayment`: references, amounts, currency, status, timestamps, refund details) and `AuditLog` entries are **kept after a campaign is purged** and are never deleted by the 7-day job. Campaign content/name is removed from payment line items on purge. The exact statutory period (tax/audit) is set by the business with its accountant; until a purge rule for payments is added, they are retained indefinitely.

## Training-data foundation (no model yet)
The rules ranker (`deterministic-v1`) is **unchanged** and still makes every decision. Alongside it the backend now records anonymized decisions so a lightweight model can be trained later. Full details: [TRAINING_DATA.md](./TRAINING_DATA.md).
