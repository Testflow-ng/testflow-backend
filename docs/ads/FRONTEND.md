# Frontend notes — Ads Manager API

Base: `/api`. Cookie auth (httpOnly `tf_access`/`tf_refresh`) — send `credentials: 'include'`. Errors: `{ error: { code, message, fields? } }` (422 carries per-field messages). Money is **integer kobo** (÷100 for ₦).

## Advertiser app (testflow.com.ng/ads)
1. `GET /ads/pricing` on load: fee, limits (title chars, **max** description words, duration range), `termsVersion` + legal URLs. Encourage short copy (`recommendedDescriptionWords: 60`); 500 words is only a ceiling.
2. Upload image first: `POST /ads/assets/images` (multipart, field `image`, ≤2 MB; JPEG/PNG/WebP, ≥300×150). Use the returned `asset.id` as `assetId` when creating the campaign.
3. Create/edit with `POST/PATCH /ads/campaigns`. Show `priceKobo` from the response — never compute your own.
4. **Checkout:** `POST /ads/checkout` with `{campaignIds, acceptTerms:true, termsVersion}`. **Send an `Idempotency-Key` header** (a fresh UUID per checkout attempt, reused on retries/double-clicks) so a retry returns the same payment. Redirect the user to `authorizationUrl`. On return from the provider call `GET /ads/checkout/verify?reference=…` and poll campaign status (the webhook may arrive first or second). Paid ≠ live: the campaign shows `pending_review` until an admin approves.
5. Dashboard: `GET /ads/dashboard` (counts), `GET /ads/campaigns?group=active|pending_review|rejected|expired|archived`. Expired campaigns stay for 7 days (show a countdown from `purgeAt`) with a **Republish** button (`POST /ads/campaigns/:id/republish` → new draft → checkout again). Rejected campaigns show `rejectionReason`, can be edited then `POST …/resubmit` (no second payment), and disappear after 30 days if untouched.
6. Analytics: `GET /ads/campaigns/:id/analytics?from&to` → `totals` (eligibleRequests, impressions, uniqueViewers, clicks, whatsappClicks, ctr %, whatsappCtr %) and `daily[]`.
7. Rate limits: auth (20/15 min), uploads (40/h), checkout (30/h) return `429 RATE_LIMITED`.
8. **Sessions:** if the cookie domain is shared across subdomains, a browser holds one session at a time — signing in as an advertiser signs out the student session in that browser. An advertiser needs an email not already used by a student.

## Student CBT app (ad slot after a completed session)
1. After the session is **submitted**: `POST /ads/serve {sessionType:'exam'|'post_utme', sessionId}`.
   - `ad:null` + `reason` → show nothing. Otherwise render a clearly labelled **"Sponsored"** card (`ad.label`) with `title`, `description`, `imageUrl`, and a CTA (`cta.href`, `cta.type` = `url|whatsapp`), plus Continue / Skip.
   - Reloading returns the same ad (one ad per session). `serveId` identifies it for events.
2. Report events with `POST /ads/events {serveId, eventId, type, visibleMs?}`:
   - `eventId` = **a new UUID per event** (idempotency key; safe to retry the same one).
   - `impression`: only after the ad was rendered ≥50% visible for **≥1000 ms**; send `visibleMs` (≥1000) — otherwise 422.
   - `click` (opened/viewed the ad) and `whatsapp_click` (tapped the WhatsApp button) require the impression first (else 409). `skip` any time.
   - Open the destination from `redirectUrl` in the response (or `cta.href`). `duplicate:true` is success, not an error.
3. Never show advertiser identity or keywords; none are returned.
