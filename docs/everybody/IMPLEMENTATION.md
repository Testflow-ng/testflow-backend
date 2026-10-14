# Testflow for Everybody — architecture & implementation document

> **Status: design only.** Nothing in this document is implemented yet. Every section marks what **exists today** (verified in this repository) versus what is **proposed**. Update the *Implementation status* table (§22) as phases land. Decisions that need a business answer are collected in §22.3.
>
> Not legal advice: §21 lists data-protection considerations; nothing here is a certification of compliance.

**Where the requested topics live:** overview §1 · existing architecture §2 · proposed architecture §3 · data model, indexes & rollout §4 · isolation/security §5 · plans & billing §6 · onboarding §7 · domains §8 · site builder §9 · CBT §10 · students §11 · analytics §12 · community §13 · ads §14 · super-admin §15 · API §16 · payments/lifecycle §17 · jobs/domain verification §18 · errors/audit §19 · testing §20 · security & privacy §21 · phases/remaining §22.

## 1. Product overview and requirements
Testflow for Everybody lets schools, tutorial/training centres, communities and CBT managers run their **own branded CBT platform** on the existing Testflow CBT engine, without building software. Entry point: `testflow.com.ng/everybody`. Each organisation (tenant) gets an isolated workspace/dashboard and a public CBT website at `name.testflow.com.ng` or a verified custom domain.

It is one multi-tenant SaaS on the existing backend — **not** a deployment per organisation.

| Requirement | Decision |
|---|---|
| Plans | **Pro** (initial ₦7,000/month, ads enabled) and **Studio** (initial ₦20,000/month, ads disabled). Prices/availability/entitlements are database configuration edited by super-admins, never constants. |
| Isolation | Server-enforced per-tenant isolation of students, questions, exams, results, analytics, site, assets, community, subscriptions (§5). |
| Reuse | Existing CBT sessions/questions, centralized identity (memberships), payment-provider interface, R2 image pipeline, Ads system, audit log, scheduler (§2). |
| Ads | Pro: sponsored ads after completed sessions via the existing Ads system. Studio: never. Derived from verified subscription state only (§13). |
| Billing | Subscription billing is separate from advertiser campaign billing (§17). |

## 2. Existing architecture and reusable components (verified)
Stack: Node 22 ESM, Express 4, MongoDB/Mongoose (no transactions assumed; atomic guarded updates are the project pattern), zod validation, JWT httpOnly cookies, `node --test` tests, Swagger in `docs/openapi.js`. **API prefix today: `/api` (no version prefix).**

| Area | Exists today | Reuse for Everybody |
|---|---|---|
| Identity | One `User` per email; `User.memberships[{product,role}]` (`student`, `ads`); `requireMembership`; active-product claim; CSRF origin check + double-submit token; code+PKCE for other domains; shared rate limiter | Add product `everybody`; org roles live in a new `OrgMembership` (§4). Tenant sites on subdomains share the cookie via `COOKIE_DOMAIN=.testflow.com.ng`. |
| Authorization | `authenticate`, `authorize('admin')` (admin ⊇ super_admin), `requireMembership` | Add `requireOrgRole(...)` (§5). Platform super-admin = existing `super_admin`/`admin` role, never a client field. |
| CBT | `Subject` (global unique `code`), `Question` (stem/options/correctIndex/topic/difficulty), `ExamSession` (per-student attempt with server-side timing & scoring, answer key stripped from responses), `PostUtmeSession`, Live CBT (`LiveExam`, WebSocket) | Add nullable `organization` to `Subject`, `Question`, `ExamSession` + new `OrgExam` (§10). No new exam engine. |
| Payments | Provider interface (`services/ads/payment`: `initialize`, `verify`, `verifyWebhookSignature`, `parseWebhook`, `refund`) with a Paystack adapter (**not yet exercised live**); idempotent `status != paid → paid` claim; reconciler job | Reuse the interface and the claim pattern; **separate** `SubscriptionPayment` collection (§6, §17). |
| Storage | Cloudflare R2 client (`utils/r2.js`) + `sharp` image validation/optimisation (`image.service`) | Org logos/favicons/hero images (§7). |
| Ads | Campaigns, moderation, deterministic ranker `deterministic-v1`, serve/event APIs, anonymized `AdDecision` training log, retention jobs | Add a tenant-aware eligibility gate (§13). |
| Jobs | In-process scheduler with Mongo lease lock (`JobLock`), `JobRun` log | New jobs: subscription lifecycle, domain re-verification, invitation cleanup (§18). |
| Audit | `AuditLog` (`recordAction`) | New actions (§19). |
| **Not present** | Organisations, tenants, subscriptions for organisations, custom/sub-domains, site builder, communities, org roles | Proposed below. A repository search found no existing community, organisation or subscription code. |

## 3. Proposed system architecture
```
Browser (acme.testflow.com.ng | cbt.acme.com | testflow.com.ng/everybody)
   │  same SPA bundle (Vercel); hostname decides which experience renders
   ▼
/api/v1/public/site  ── resolves hostname → Organization + published SiteConfig   (public, cacheable)
/api/v1/everybody/*  ── authenticated org dashboard APIs (membership-checked)
/api/v1/admin/everybody/* ── platform super-admin
   ▼
Express → services → Mongo (tenant-scoped models) ; R2 (assets) ; payment provider ; DNS (TXT lookups)
```
- **Versioning decision:** the repo has no version prefix; new Everybody routes are mounted at **`/api/v1/...`** as specified; existing routes are untouched. (Frontend may keep the path in one constant.)
- **One SPA, two modes:** the frontend inspects `window.location.hostname`; on a tenant hostname it calls `GET /api/v1/public/site` and renders the tenant site template; on `testflow.com.ng` it renders the Testflow app. Wildcard DNS/hosting for `*.testflow.com.ng` is an infrastructure task (§18).
- **Tenant id is never taken from the client for authority.** Org-scoped routes carry `:organizationId` in the path, but the server checks the caller's `OrgMembership` for exactly that id (§5).

## 4. Multi-tenant data model
Conventions: `organization` (ObjectId, indexed, **required** on tenant-owned documents); money in integer **kobo** (as in Ads); timestamps via Mongoose; `toJSON` strips internals.

| Collection | Key fields | Constraints / indexes |
|---|---|---|
| `Organization` | `name`, `slug`, `status` (`active\|suspended\|closed`), `ownerUser`, `contactEmail`, `timezone`, `createdAt` | unique `slug`; idx `(status, createdAt)` |
| `OrgMembership` | `organization`, `user`, `role` (`owner\|admin\|examiner\|student`), `status` (`active\|suspended\|removed`), `studentRef` (org's own ID), `invitedBy`, `joinedAt` | unique `(organization, user)`; idx `(organization, role, status)`, `(user)`; exactly one `owner` per org (enforced in service, partial unique index on `{organization, role:'owner'}`) |
| `OrgInvitation` | `organization`, `email`, `role`, `tokenHash`, `expiresAt`, `acceptedAt`, `invitedBy`, `maxUses` | unique `tokenHash`; TTL on `expiresAt`+grace; idx `(organization, email)` |
| `PlanDefinition` | `key` (`pro\|studio`), `name`, `priceMinor`, `currency`, `interval`, `available`, `entitlements` (`adsEnabled`, `maxStudents`, `maxActiveExams`, `maxExamsPerMonth`, `customDomain`, `storageMb`, `communityEnabled`…), `sortOrder`, `updatedBy` | unique `key`; seeded with Pro/Studio defaults; editable only via super-admin API |
| `Subscription` | `organization`, `planKey`, **plan snapshot** (`priceMinor`, `entitlements` at purchase), `status` (`pending\|active\|past_due\|expired\|cancelled`), `currentPeriodStart/End`, `cancelAtPeriodEnd`, `pendingPlanKey` (scheduled downgrade), `graceEndsAt`, `lastPaymentId` | **at most one non-terminal subscription per org** (partial unique index on `{organization}` where status ∈ pending/active/past_due); idx `(status, currentPeriodEnd)` |
| `SubscriptionPayment` | `reference` (`SUB-…`), `organization`, `subscription`, `kind` (`new\|renewal\|upgrade`), `planKey`, `amountKobo`, `currency`, `status` (`initialized\|paid\|failed\|abandoned\|refunded`), `provider`, `authorizationUrl`, `paidAt`, `verifiedAt`, `idempotencyKey`, `processedEventIds` | unique `reference`; unique `(organization, idempotencyKey)` (partial); idx `(organization, createdAt)`, `(status, createdAt)`. **Financial record — never auto-deleted.** |
| `OrgDomain` | `organization`, `hostname`, `type` (`subdomain\|custom`), `status` (`pending\|verified\|active\|failed\|removed`), `verification` (`token`, `method`, `expiresAt`, `lastCheckedAt`, `failures`), `isPrimary`, `verifiedAt` | unique `hostname` among non-removed (partial); ≤1 active subdomain per org; idx `(organization)` |
| `SiteConfig` | `organization`, `templateKey`, `draft` (validated object), `published` (snapshot), `draftVersion`, `publishedVersion`, `publishedAt`, `publishedBy` | unique `organization` |
| `SiteVersion` | `organization`, `version`, `config`, `createdBy`, `createdAt` | unique `(organization, version)`; keep last 20 |
| `OrgAsset` | `organization`, `kind` (`logo\|favicon\|hero\|image`), `storageKey`, `url`, `width/height/bytes`, `attachedAt` | idx `(organization, kind)`; orphan sweep like `AdAsset` |
| `OrgExam` | `organization`, `title`, `instructions`, `subject`/`questionIds`, `numQuestions`, `durationMinutes`, `availableFrom/Until`, `access` (`enrolled\|assigned\|code`), `accessCodeHash`, `attemptsAllowed`, `shuffleQuestions/Options`, `marksPerQuestion`, `negativeMarking`, `resultsVisibility`, `status` (`draft\|published\|archived`), `createdBy` | idx `(organization, status, availableFrom)` |
| `ExamAssignment` | `organization`, `exam`, `student` or `group` | unique `(exam, student)`; idx `(organization, student)` |
| `OrgGroup` | `organization`, `name`, `members[]` | unique `(organization, name)` |
| `Community`, `CommunityPost`, `CommunityComment` | per-org settings; posts (`announcement\|discussion`, plain text, `pinned`, `status`), comments; all carry `organization` | idx `(organization, createdAt)`, `(organization, pinned)` |
| *Extended existing* | `Subject`, `Question`, `ExamSession`: add `organization` (default `null` = global Testflow); `ExamSession`: `orgExam`; `AdServe`/`AdDecision`: `placement` (`main\|org`), `tenantKey` (HMAC pseudonym of org id) | `Subject.code` unique index becomes unique `(organization, code)`; see §10 |

Retention: org data is kept while the org exists; after **closure** it is retained 12 months (configurable) then exported/deleted by an explicit admin job with prior notice (§17). Payment and audit records follow the financial retention policy already adopted for Ads.

Rollout: additive collections; the `Subject` index change and `organization` backfill (`null`) run through an idempotent script with `--dry-run`, in the same style as `migrate-memberships.js`.

## 5. Tenant isolation and security model
1. **Membership gate.** `requireOrgRole('owner','admin',...)` loads `OrgMembership{organization:req.params.organizationId, user:req.user._id, status:'active'}` from the database. No membership → **404** (not 403, to avoid confirming that other tenants exist). Role insufficient → 403. The organisation must be `active` for writes (suspended → 403 `ORG_SUSPENDED`).
2. **No client authority.** `organizationId` in bodies/queries is ignored/rejected; the gate's `req.org` is the only org used. Super-admin access is an explicit separate route family.
3. **Scoped data access.** All tenant models are accessed through `scoped(Model, req.org._id)` helpers that inject `{organization}` into every filter, update and aggregation `$match`, and every create sets `organization` from `req.org`. A Mongoose guard on tenant models throws if a query lacks an `organization` condition (default-deny), preventing accidental unscoped queries.
4. **Global models stay safe by default.** For `Subject`, `Question`, `ExamSession` a query hook adds `organization: null` when a filter does not mention `organization`, so existing global code never returns tenant data; tenant code must opt in explicitly. Aggregations need an explicit `$match` (checked by a test that greps/loads aggregate pipelines).
5. **Object ownership.** Every `:id` loaded in an org route is fetched with `{_id, organization}`; mismatch ⇒ 404. Referenced ids in bodies (`subject`, `questionIds`, `student`) are verified to belong to the same org.
6. **Students in several orgs.** One `User`, one `OrgMembership` per org. Authenticating once grants nothing: every student call re-checks the membership for the org being accessed.
7. **Database-level isolation (evaluated).** MongoDB has no row-level security. Per-tenant databases/collections add operational cost and break cross-tenant platform analytics; rejected for v1. Defence in depth instead: scoped helpers, default-deny guard, indexes that start with `organization`, and isolation tests in CI.
8. **Safe hostname handling** — §8.

## 6. Subscription plans and billing
- `GET /plans` is built from `PlanDefinition` (available plans only). Seed values: Pro `700000` kobo, Studio `2000000` kobo, interval month, currency NGN.
- `Subscription` stores a **snapshot** of price and entitlements at purchase, so later price edits do not change an active period; renewals use the then-current price (shown before checkout).
- **Entitlements** are computed server-side: `entitlementsFor(org)` = plan snapshot of the org's current subscription, gated by state (§17). Feature gates (`maxStudents`, `maxActiveExams`, `customDomain`, `adsEnabled`, …) call this function; client-sent plan names/prices are ignored.
- Checkout reuses the provider interface. Reference prefix `SUB-` (ads use `ADS-`). One Paystack webhook URL can serve both: the existing handler dispatches by reference prefix; subscription payments never touch `AdPayment`.

## 7. Organization onboarding
1. A signed-in user (existing account; `everybody` membership added automatically) calls `POST /organizations {name, slug?, contactEmail}`; the creator becomes `owner`. The organisation starts `active` with **no subscription** (`pending`): can configure but cannot publish a site or open exams until a subscription is active (draft/setup mode).
2. Subdomain chosen during onboarding or later (§8). Plan selected via `POST /subscriptions` → checkout.
3. Invitations: owner/admin creates `{email, role}`; the 32-byte token is emailed (hash stored, 7-day expiry, single use, bound to the email — accepting requires the signed-in account's verified email to match or an explicit join code). Accepting creates the `OrgMembership`.

## 8. Custom domains and Testflow subdomains
**Subdomain (free):** label rules `^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$`, no consecutive hyphens, reserved list (`www, api, admin, ads, app, mail, cdn, static, everybody, docs, status, support, billing, login, …` plus profanity/brand list), case-folded, unique across subdomains **and** the reserved set. Availability check endpoint; assignment is an atomic insert guarded by the unique index. Changing a subdomain releases the old one after a 30-day hold (prevents takeover of links).
**Custom domain:** hostname validated (IDNA→punycode, ≤253 chars, public suffix aware, not an IP, not under `testflow.com.ng`). Ownership proof: the org adds `TXT _testflow-verify.<host> = tf-verify=<token>` (token random, stored, expires in 7 days) and a `CNAME <host> → cname.testflow.com.ng`. `POST …/verify` resolves TXT via Node `dns.promises` (**mockable**, with timeout) and compares in constant time. A hostname already `verified/active` for another org is refused (409). Verified ⇒ `verified`; `active` only after the infrastructure step below succeeds. A job re-checks active domains daily; repeated failures flag `failed` and notify admins.
**Tenant resolution:** `GET /api/v1/public/site` reads the hostname from `X-Forwarded-Host` (only when `TRUST_FORWARDED_HOST=true`, i.e. behind the known proxy) else `Host`; it is lower-cased, port-stripped, syntax-validated (rejects IP literals, `localhost`, overly long, invalid labels), then looked up in `OrgDomain` (`active` only). Unknown/inactive/suspended ⇒ a generic 404 `SITE_NOT_FOUND` (no detail). **Security note:** host is used only to select *public* site content; it never grants authority — authenticated tenant actions are decided by membership (§5), so a spoofed host cannot read another tenant's private data.
**Infrastructure (manual / not provable from the backend):** wildcard DNS `*.testflow.com.ng` and wildcard hosting on the frontend platform (Vercel), the CNAME target, per-domain TLS issuance (platform Domains API or manual), and cookie domain. Custom domains are **not claimed operational** until tested end-to-end (DNS → TLS → routing). Custom-domain sessions are on a different registrable domain, so students there use the existing code+PKCE exchange, registered as an `AUTH_CLIENTS` client per tenant host.

## 9. No-code website builder
Structured, validated JSON — no generated code, no per-tenant deployment.
- **Templates:** static registry in code (`classic`, `modern`, `minimal`) defining allowed sections/slots; `GET /templates` lists them.
- **SiteConfig shape (zod, strict):** `brand {name, logoAssetId, faviconAssetId, primaryColor, accentColor (#RRGGBB)}`, `seo {title≤70, description≤160}`, `nav[{label,href}]≤8`, `sections[]` ordered (≤12) of typed blocks: `hero{heading, subheading, imageAssetId, cta{label,url}}`, `about`, `features[{title,text,icon}]`, `exams{title, showUpcoming}`, `faq[{q,a}]`, `contact{email,phone,address,whatsapp}`, `cta`, plus `footer{text, links[]}`. Unknown keys rejected.
- **Safety:** plain text only (no HTML; reuse `plainText`), URLs https-only via the existing `parseDestinationUrl`, WhatsApp via `parseWhatsappNumber`, colours hex-only, asset ids must belong to the org, sizes capped (config ≤ 64 KB).
- **Lifecycle:** `PATCH /site` edits the **draft** (optimistic `draftVersion`); `POST /site/preview` returns a signed short-lived preview token/payload of the draft; `POST /site/publish` copies draft → `published` atomically, bumps `publishedVersion`, writes a `SiteVersion`. The public endpoint serves only `published`. Roll back = publish an older version. Publishing requires an active subscription.
- **Assets:** `POST /site/assets` reuses the sharp/R2 pipeline (WebP, EXIF stripped, size caps); favicon ≤ 256 px.

## 10. CBT configuration and exam management
Reuse the engine; add tenancy.
- **Subjects/questions:** tenant `Subject`/`Question` documents carry `organization`; global ones keep `null`. Existing validation (2–6 distinct options, `correctIndex`) is reused. Org bulk question import (JSON, ≤500 per call). Org staff cannot read or modify global content, and global students never see org content (§5.4).
- **`OrgExam`** (§4): duration, instructions, availability window, access mode (`enrolled`, `assigned`, `code`), attempts allowed, shuffle, marking, results visibility; draft → published → archived; publishing validates question availability and entitlements.
- **Attempts:** `POST /student/exams/:examId/start` reuses `ExamSession` (server-owned clock, answers, scoring, answer key withheld) with `organization` + `orgExam` set; eligibility (membership active, window, assignment/code, attempts left, subscription state) is checked server-side before creating the session. Results visibility (`immediate|after_window|manual`) controls when scores/answers are returned.
- Existing global routes (`/api/subjects`, `/api/questions`, `/api/exam-sessions`) keep their contracts and are made tenant-safe by the default-deny hook; they are not reused for org staff.

## 11. Student management and result analytics (students)
Org students are `OrgMembership{role:'student'}` on the shared `User` (no duplicate accounts). Enrol by email (existing account → membership; new → invitation), bulk import (≤500 rows), list/search/paginate, view profile (name, org student ref, status — **no** global-platform data), activate/deactivate (`suspended`), unenrol (`removed`; history kept), assign exams, view per-student history/results (examiner+ only). Student-facing data is limited to their own attempts.

## 12. Results and analytics
All aggregations start with `$match:{organization}` on `ExamSession` (indexed `(organization, orgExam, status, submittedAt)`), paginated, `allowDiskUse` off, max range 366 days.
| Metric | Definition |
|---|---|
| Enrolled students | active `OrgMembership` role student |
| Active students | enrolled with ≥1 submitted attempt in the range |
| Total / published exams | `OrgExam` counts by status |
| Attempts | submitted `ExamSession`s in range |
| Completion rate | submitted ÷ (submitted + expired-unsubmitted) |
| Average score % | mean of `correct/total×100` over submitted attempts |
| By subject / by exam | the same metrics grouped by subject / `orgExam` |
| Activity over time | attempts per day (UTC) |
Student-level endpoints require examiner/admin/owner; students see only themselves. Aggregates for super-admin never include student identities.

## 13. Community
No community code exists today. **Foundation (phase 6):** per-org `Community` settings (enabled, who may post), **announcements** (staff only) and **discussions** with comments (members), pin/hide/delete moderation by staff, membership = active `OrgMembership`. Plain text only, length caps, rate limits, soft-delete with audit. Out of scope for now (documented, not built): reactions, DMs, media uploads, notifications, follows, search.

## 14. Advertising integration
Existing system reused; nothing duplicated.
- **Eligibility gate:** the student serve call (`POST /ads/serve`) accepts an org context only through the **server-resolved** session: for an org `ExamSession` the service loads the session's `organization`, computes `entitlementsFor(org)`, and returns `{ad:null, reason:'org_ads_disabled'}` unless `adsEnabled` is true **and** the subscription is `active`/`past_due`(grace). Studio, expired, suspended or unsubscribed orgs never get ads. No request parameter can enable ads.
- **Placement:** unchanged — after a completed session only; never during an exam.
- **Targeting:** today campaigns have **no** placement/tenant targeting; by default an approved campaign is eligible on the main platform **and** Pro organisations. Per-campaign placement restrictions and an org-level opt-out would be new, explicit, server-enforced settings (not built; decision in §22.3).
- **Attribution:** `AdServe`/`AdDecision` gain `placement` and `tenantKey` (HMAC pseudonym of the org id) so impressions/clicks/skips can be reported per placement without exposing org identities to advertisers. Training logs stay anonymized.
- **Billing separation:** advertiser campaign payments stay in `AdPayment`; organisation subscriptions in `SubscriptionPayment`; neither grants the other. **Revenue sharing with organisations is not assumed and not implemented** (open decision).
- **Plans:** the Ads product has no subscription plans (pay-per-campaign by day, admin-set daily fee); no advertising "plans" are invented.

## 15. Super-admin management
Under `/api/v1/admin/everybody/*` (existing `authenticate` + `authorize('admin')`; **plan/price/entitlement edits and suspend/reinstate require `super_admin`** via `authorize('super_admin')`): list/search organisations, inspect an org (status, subscription, domains, usage counts), suspend/reinstate, edit `PlanDefinition` (price, availability, entitlements; takes effect for new checkouts/renewals, active periods keep their snapshot), activate/deactivate plans, inspect subscriptions and payments, force-expire/extend a subscription (audited, reason required), inspect domain verification state, aggregate usage, audit-log view, ads-integration health (ads served on org placements, gate rejections). Every sensitive action requires a reason and writes `AuditLog`.

## 16. API endpoints
Common: JSON; errors `{error:{code,message,details?,fields?}}`; lists `?page&limit` → `{items,page,limit,total}`; cookie auth + CSRF rules from the identity system; `Idempotency-Key` on payment-creating calls. "Org gate" = `requireOrgRole(...)` on `:organizationId` (404 for non-members). Roles: **O** owner, **A** admin, **E** examiner, **S** student, **SA** super-admin.

**Plans & subscriptions** (`/api/v1/everybody`)
| Method & route | Auth / role | Request | Response | Errors / notes |
|---|---|---|---|---|
| `GET /plans` | public | – | `[{key,name,priceMinor,currency,interval,adsEnabled,available,entitlements}]` | only `available` plans |
| `GET /subscription` | auth + org via `?organizationId` + O/A | – | current subscription + `entitlements` + state | 404 none |
| `POST /subscriptions` | O (org gate via body `organizationId` validated against membership) | `{organizationId, planKey}` | `201 {subscription(status:pending)}` | 409 `SUBSCRIPTION_EXISTS`; 422 plan unavailable |
| `POST /subscriptions/:id/checkout` | O | `Idempotency-Key` | `201 {paymentId,reference,amountKobo,currency,authorizationUrl}` | amount from server; 409 not payable; 503 provider not configured |
| `GET /subscriptions/:id` | O/A | – | subscription + payments summary | 404 other tenant |
| `POST /subscriptions/:id/cancel` | O | `{atPeriodEnd:true}` | subscription | cancels renewal; access until period end |
| `POST /subscriptions/:id/renew` | O | `Idempotency-Key` | checkout (as above) | allowed `active` (≤14 days before end), `past_due`, `expired` |
| `POST /subscriptions/:id/upgrade` | O | `{planKey}` | checkout for the prorated difference | pro→studio immediate; studio→pro scheduled (`pendingPlanKey`) |
| `GET /payments/verify?reference=` | O/A | – | payment + subscription | re-verifies with provider; idempotent |
| `POST /payments/webhook` | provider signature | provider payload | `200` | HMAC-SHA512 on raw body; re-verify via API; dispatch by reference prefix |

**Organizations** — `POST /organizations` (auth; creates owner) · `GET /organizations` (auth; the caller's orgs; SA lists all via admin route) · `GET|PATCH /organizations/:organizationId` (A/O) · `GET /…/members` (A/O) · `POST /…/invitations {email,role}` (A/O; role ≤ caller's; only O can invite admins) · `PATCH /…/members/:memberId {role?,status?}` (A/O; cannot touch owner; cannot self-escalate) · `DELETE /…/members/:memberId` (A/O) · `POST /invitations/accept {token}` (auth).
**Domains** — `GET /domains/check-subdomain?name=` (auth, rate-limited) · `POST|GET /organizations/:id/domains` · `POST /…/domains/:domainId/verify` · `DELETE /…/domains/:domainId` (O/A).
**Site** — `GET /templates` · `GET|PATCH /organizations/:id/site` · `POST /…/site/preview` · `POST /…/site/publish` · `POST /…/site/assets` (O/A) · **public** `GET /api/v1/public/site` (hostname-resolved; `{organization:{name,slug}, site: published config, features:{adsEnabled:false…}}`, `Cache-Control: public, max-age=60`).
**Students** — `GET|POST /organizations/:id/students`, `GET|PATCH|DELETE /…/students/:studentId`, `POST /…/students/bulk`, `POST /…/students/:studentId/assignments` (A/O; E read-only list/profile of assigned).
**CBT** — `/organizations/:id/subjects`, `/…/questions` (+ `/bulk`), `/…/exams` (+ `/:examId/publish`, `/:examId/unpublish`, `/:examId/assignments`), `/…/attempts`, `/…/results` (A/O/E; results read: A/O/E); student side: `GET /organizations/:id/my/exams`, `POST /…/my/exams/:examId/start`, then the existing session answer/submit semantics scoped to the org.
**Analytics** — `GET /organizations/:id/analytics/{overview,examinations,students,performance}` (A/O; E for exams they own; metrics §12).
**Community** — `GET|PATCH /organizations/:id/community`, `GET|POST /…/community/posts`, `PATCH|DELETE /…/community/posts/:postId`, `POST /…/community/posts/:postId/comments`, moderation `POST /…/community/posts/:postId/hide`.
**Ads** — reuse `/api/ads/*`; add only `GET /organizations/:id/ads/status` (O/A: whether ads are enabled by entitlement, reason) and the serve-time gate (§14). Super-admin: `GET /admin/everybody/ads/health`.
**Super-admin** (`/api/v1/admin/everybody`) — `GET /organizations`, `GET /organizations/:id`, `POST /organizations/:id/suspend|reinstate` (SA), `GET|PATCH /plans`, `GET /subscriptions`, `POST /subscriptions/:id/extend|expire` (SA), `GET /payments`, `GET /domains`, `GET /analytics/overview`, `GET /audit`, `GET /jobs`.
Per-endpoint request/response schemas will be added to `docs/openapi.js` (tags **Everybody: …**) as each phase ships; this table is the contract the implementation follows.

## 17. Payment verification and subscription lifecycle
Same guarantees as the Ads payment flow: server prices; redirect never activates; `charge.success` webhook (signed) **and/or** `verify` → provider re-verification → check amount + currency + reference → one atomic claim `status != paid → paid` (duplicates are no-ops) → activate. A reconciler job verifies stale `initialized` payments and repairs "paid but subscription pending".

States: `pending → active ⇄ past_due → expired`; `active → cancelled(at period end)`; `expired → active` on payment.
- **Activation:** period = 1 month from `max(now, previous end)`; entitlements snapshotted.
- **Renewal:** manual checkout (no stored card/auto-charge in v1; recurring authorisation is a later, separately verified feature). Renewing early extends from the current end (no lost days).
- **Past due (grace, default 7 days, configurable):** full access continues; owner/admin are told to renew.
- **Expired policy (no silent deletion):** workspace becomes **read-only**: admins can view and export data and results; the public site shows a neutral "temporarily unavailable" page; students cannot start new attempts (in-progress attempts may finish); no new exams, students, publishing or ads. Data is retained (default 12 months, configurable) with warnings; deletion happens only via an explicit, audited admin job. **Reactivation** by paying restores everything exactly as it was.
- **Upgrade (pro→studio):** immediate; price = prorated difference for remaining days (integer kobo, server-computed) and the period end is unchanged. **Downgrade:** scheduled at period end, no refund.
- **Payment failure:** payment `failed`, subscription state unchanged; the org may retry.
- **Cancellation:** stops renewal; access until period end; then expires.
- **Admin overrides** (extend/expire) are audited with reasons.
- Subscription billing and advertiser billing are different collections and flows (§14).

## 18. Background jobs and domain verification
Run on the existing scheduler/`runJob` (lease locks, retries, `JobRun` logs, idempotent):
| Job | Interval | Work |
|---|---|---|
| `everybody-subscriptions` | 5 min | move `active→past_due→expired` by dates; apply scheduled downgrades/cancellations; reconcile stale `SubscriptionPayment`s; repair paid-but-pending |
| `everybody-domains` | 1 h | re-resolve TXT/CNAME for pending (until token expiry) and active domains; flag failures |
| `everybody-cleanup` | 1 h | expire invitations/preview tokens, sweep orphan `OrgAsset`s |
**Infrastructure to configure manually:** wildcard DNS and hosting, the CNAME target host, TLS for custom domains (platform Domains API or manual), `TRUST_FORWARDED_HOST`, `COOKIE_DOMAIN=.testflow.com.ng`, `ALLOWED_ORIGINS`, Paystack credentials/webhook. Environment variables are added to `.env.example` as implemented.

## 19. Error handling and audit logging
Reuses `AppError` + the global handler and codes such as `NOT_FOUND`, `VALIDATION_ERROR`, `NO_MEMBERSHIP`, plus: `ORG_SUSPENDED`, `SUBSCRIPTION_REQUIRED`, `SUBSCRIPTION_EXPIRED`, `PLAN_UNAVAILABLE`, `ENTITLEMENT_EXCEEDED`, `SUBDOMAIN_TAKEN`, `SUBDOMAIN_RESERVED`, `DOMAIN_CLAIMED`, `DOMAIN_NOT_VERIFIED`, `SITE_NOT_FOUND`, `INVITATION_INVALID`. No stack traces/secrets in responses (existing behaviour). New `AuditLog` actions: `ORG_CREATE|UPDATE|SUSPEND|REINSTATE`, `ORG_MEMBER_ADD|UPDATE|REMOVE`, `ORG_INVITE`, `SUBSCRIPTION_CREATE|ACTIVATE|CANCEL|EXPIRE|UPGRADE|ADMIN_EXTEND`, `SUBSCRIPTION_PAYMENT_VERIFIED`, `PLAN_UPDATE`, `DOMAIN_ADD|VERIFY|REMOVE`, `SITE_PUBLISH`, `ORG_EXAM_PUBLISH`, `ORG_DATA_EXPORT`. Audit entries hold ids and non-sensitive metadata only.

## 20. Testing strategy
`node --test` in the existing style: pure unit tests (always run) and DB-backed integration tests gated by `MONGODB_URI_TEST` (disposable database). Providers (payment, DNS, R2, ads) are injected mocks, as with the Ads tests.
Must cover: org creation + membership permissions; role escalation attempts; **cross-tenant IDOR** (swap org/student/exam/question/session ids in params, bodies, queries; expect 404); student/question/exam/result/analytics isolation; default-deny hook on global models; plan pricing + entitlements from DB; subscription transitions (incl. grace, expiry, reactivation, upgrade/downgrade); payment verification, amount mismatch, duplicate/parallel webhooks, subscription vs ad payments never crossing; Pro ads allowed / Studio, expired, suspended denied (including forged request parameters); subdomain uniqueness/reserved names/race; hostname resolution (spoofed/invalid hosts, inactive tenants); custom-domain verification (mock DNS: correct/incorrect token, duplicate claim, expiry); site config validation (HTML/JS injection, bad URLs, oversize, foreign asset ids), draft/publish/rollback; unauthorized super-admin operations; analytics tenant scoping; invitation token security (expiry, reuse, wrong email).
Run: `npm test`, `npx eslint src tests`. Existing repo lint errors (6, unrelated) are reported separately from regressions. Anything not executed is reported as not executed.

## 21. Security and privacy considerations
Security: the controls in §5, plus request-size limits (global JSON limit 5 MB; site config ≤ 64 KB; multipart ≤ 2 MB), rate limits (shared Mongo limiter) on onboarding, invitations, subdomain checks and domain verification, hashed single-use invitation tokens, webhook HMAC + provider re-verification, no secrets in logs, CSRF/origin protection already in place, strict zod schemas on every body.
Privacy (Nigeria Data Protection Act 2023 / NDPR — **considerations, not a compliance claim**): organisations act as *data controllers* for their students and Testflow as *processor* — publish a data-processing agreement and privacy notice; collect only name/email/student ref/results; lawful basis and consent for minors (schools) are the organisation's responsibility, with tooling to export/delete a student's org data; retention periods in §4/§17; breach-notification procedure (NDPC window) to be written; cross-border transfer (hosting) disclosed; ads on Pro plans use only the anonymized, bucketed context already described in `docs/ads/TRAINING_DATA.md` — organisations must disclose that sponsored content appears; student identities and individual performance are never given to advertisers.

## 22. Implementation phases and remaining work
### 22.1 Phases (reorderings noted)
1. **Foundation** — `Organization`, `OrgMembership`, `OrgInvitation`, `requireOrgRole`, scoped helpers + default-deny hook, indexes, product `everybody`, tests.
2. **Plans & subscriptions** — `PlanDefinition` seed/admin edit, `Subscription`, `SubscriptionPayment`, checkout/verify/webhook dispatch, entitlements, lifecycle job, tests.
3. **Routing & domains** — subdomains, resolution, custom-domain verification (mock DNS), infra doc.
4. **Website configuration** — templates, `SiteConfig`, preview/publish, assets.
5. **CBT integration** — `organization` on `Subject/Question/ExamSession`, `OrgExam`, assignments, org attempts/results; **migration of the `Subject.code` index** (must precede tenant subject creation).
6. **Analytics & community.**
7. **Ads integration** — entitlement gate in `serveAd`, `placement/tenantKey`, org ads status.
8. **Administration & hardening** — super-admin API, audit, security tests, OpenAPI.
*Reordering rationale:* none yet; phase 5's index migration is the only cross-phase dependency (phases 1–4 do not create tenant subjects).

### 22.2 Implementation status
| Area | Status |
|---|---|
| This document | ✅ written |
| Phase 1 (foundation: `Organization`, `OrgMembership`, `OrgInvitation`, `requireOrgRole`, scoped helpers, org routes at `/api/v1/everybody`) | ✅ implemented; unit tests pass (7/7), DB integration tests written but not yet executed (no test database) |
| Phases 2–8 | ⬜ not started (no code exists) |
| Existing prerequisites (identity/memberships, payment interface, R2, Ads, jobs, audit) | ✅ implemented earlier; payment provider, R2 and Safe Browsing integrations **unverified against live services** |
| DB-backed tests of existing features | ⬜ written but not yet executed (no test database) |

### 22.3 Unresolved product / infrastructure decisions
1. **Name/URL:** "Everybody" (spec, URL `/everybody`) vs "Everyone" (OG copy) — confirm the public name.
2. **Ads revenue share** with Pro organisations: none assumed; decide whether/how organisations earn.
3. **Organisation ad opt-out / campaign placement targeting** (main vs org) — default is "all placements"; confirm.
4. **Plan entitlement numbers** (student/exam/storage limits) for Pro vs Studio — only `adsEnabled` is specified; set initial limits.
5. **Grace period (7d) and data-retention (12 months)** defaults; **recurring/auto-renewal** via provider authorisations (not in v1).
6. **Upgrade/downgrade proration** policy as proposed in §17.
7. **Custom-domain TLS/routing** mechanism (Vercel Domains API vs manual) and the wildcard DNS setup.
8. Student invitation/e-mail delivery (the project has an email service but verification email is currently disabled) and **who may import students**.
9. DPA/privacy notice wording and breach procedure (legal review).

### 22.4 Next steps
Start phase 1. Before phase 5, run an audit of every `Subject`/`Question`/`ExamSession` query and aggregation (including `admin.controller`, `public.controller`, `subject.service`, `question.service`, `examSession.service`, live CBT) to confirm the default-deny scope is complete.
