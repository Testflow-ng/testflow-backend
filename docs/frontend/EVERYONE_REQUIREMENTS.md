# Testflow for Everyone: what the frontend console needs from the backend

The frontend now has an organisation console (`/everybody/app/*`). It follows `docs/everybody/IMPLEMENTATION.md` (section 16) and
needs the additions below. Everything is scoped to `:organizationId`; owner/admin roles as in section 16.
Money is integer kobo, errors use `{ error: { code, message } }`, lists use `{ items, page, limit, total }`.

> **Phase 1 scope (what the frontend uses right now):** an organisation can change only its **name**, its **logo** and its **domain**
> (Testflow subdomain or their own). Those appear everywhere "Testflow" would, including the share image. Use `PATCH /organizations/:id/site`
> with `brand: { name, logoUrl }` and `POST /site/publish`. The full page editor in section 1 is built in the frontend but switched off
> (`WEBSITE_EDITOR_ENABLED=false`); it comes later, so section 1 is lower priority than sections 2 to 6.

## 1. Editable words and images, on both sides of the site (later)

A site has two surfaces, each its own block list, so an owner can edit the public landing page and the student portal (what
students see after they sign in).

`GET|PATCH /organizations/:id/site` returns and accepts:

```json
{
  "template": "modern",
  "brand": { "name": "Grace CBT", "tagline": "Pass JAMB with Grace", "logoUrl": "...", "faviconUrl": "...", "primaryColor": "#163a5f", "accentColor": "#f5c542", "font": "inter" },
  "landing": { "sections": [ { "id": "b1", "type": "hero", "heading": "", "subheading": "", "imageUrl": "...", "cta": { "label": "", "url": "" } } ] },
  "portal":  { "welcome": { "heading": "", "text": "", "imageUrl": "" }, "sections": [ ] },
  "pages":   { "exams": true, "results": true, "library": true, "community": false, "leaderboard": true, "about": true, "contact": true },
  "footer":  { "text": "", "links": [] }
}
```

- Any block may carry `imageUrl` (and `images: []` for galleries). Hero, about, features, cta and testimonials gain images.
- **`pages` is the on/off switch for each page.** A page that is `false` must not be routable on the tenant site and must disappear from
  the student navigation. The frontend hides it; the backend must also return 404 for it.
- `POST /organizations/:id/site/assets` (multipart) returns `{ asset: { id, url, width, height, bytes, contentType } }`. Allowed: png, jpeg, webp (and svg only if sanitised); max 2 MB; plan storage limits apply.
- Existing draft, preview and publish stay as designed. Publishing copies `landing`, `portal`, `brand` and `pages` together.

## 2. Questions: manual, CSV, and images

- `POST /organizations/:id/questions` and `PATCH .../questions/:qid` accept `stemImageUrl` (optional) and `options: [{ text, imageUrl? }]`
  (an option may be text, an image, or both). `correctIndex`, `topic`, `difficulty`, `explanation`, `explanationImageUrl` as before.
- `POST /organizations/:id/questions/assets` (multipart) for question images; same limits as site assets. Counted against storage.
- `POST /organizations/:id/questions/bulk` accepts the existing JSON array **and** a parsed CSV (the frontend parses the file and sends rows).
  CSV columns: `stem, optionA..optionF, correctIndex (0-based) or correct (A-F), topic, difficulty, explanation, stemImageUrl`. Max 500 rows.
  Response lists per-row problems so the UI can show them: `{ imported, failed: [{ row, problems: [] }] }`.
- Question media must be served from the platform's asset host with the org's scope (no cross-tenant reads).

## 3. The organisation's own Library and paid content

Same model as the main Library, scoped to the organisation:

- `GET|POST /organizations/:id/library/books`, `PATCH|DELETE .../books/:bookId`, `POST .../books/:bookId/file` (pdf upload).
- A book has `priceMinor` (0 = free), `currency`, `visibility` (`all_students | group | paid`), `previewPages`.
- Students: `GET /organizations/:id/my/library`, pages and download are gated like `LIBRARY_GATE.md` but by **purchase of that book or a pass sold by the organisation**, not Testflow's Student Pass.
- The same applies to paid exams (`OrgExam.priceMinor`, `accessMode: free | paid | code`).

## 4. Money: sub-accounts and the platform's share

Students of an organisation pay the **organisation**, and Testflow keeps a percentage.

- On the organisation: `payout` = `{ bankCode, accountNumber, accountName, businessName, status: none|pending|active|failed, subaccountCode, platformPercent }`.
- `GET /banks` (cached list of Nigerian banks with codes).
- `POST /organizations/:id/payout/verify` `{ bankCode, accountNumber }` returns the resolved `accountName` (Paystack resolve) so the owner confirms it before saving.
- `PUT /organizations/:id/payout` `{ bankCode, accountNumber, businessName }`: creates or updates the **Paystack subaccount** (`percentage_charge` = the platform's share, stored server-side only; the client can never set it). Returns the payout object above.
- `platformPercent` comes from the plan or a platform setting (default to be confirmed). It is read-only to the organisation and shown to them.
- Every student payment (exam, book, pass) initialises with `subaccount` and `bearer` set so Paystack splits at source. Store `grossKobo`, `platformFeeKobo`, `orgShareKobo`, `paystackFeeKobo` on `OrgPayment`.
- `GET /organizations/:id/earnings` returns `{ totals: { grossKobo, orgShareKobo, platformFeeKobo, last30d }, series: [{ date, grossKobo }] }`.
- `GET /organizations/:id/payments?page&limit&status` lists transactions with the split.
- Refunds reverse the split. Without an `active` payout account, paid items cannot be published (`422 PAYOUT_REQUIRED`).

## 5. Domains, and a brand of their own (including the share image)

- Subdomain: `GET /domains/check-subdomain?name=` and `POST /organizations/:id/domains` `{ type: 'subdomain', hostname: 'jamb.testflow.com.ng' }`; custom domains with DNS records as in section 8.
- **Share image (Open Graph):** the public site config response for a hostname (`GET /api/v1/public/site`) must return
  `meta: { title, description, ogImageUrl, themeColor, faviconUrl, canonicalUrl }`, built from the organisation's brand. A site named "Grace CBT" must produce
  "Grace CBT" in `og:title` and an image that says Grace, never Testflow's.
- Auto-generate the image if the owner has not uploaded one (name + tagline + brand colours + logo, 1200x630) via the existing `ogImage.service`, cached per organisation and regenerated on publish.
- Social crawlers do not run JavaScript, so tenant hostnames need server-rendered `<head>` tags (a small edge function or an HTML endpoint `GET /share/site` that the host rewrites to for crawler user agents). Please confirm how the frontend host should call it.
- Every public and student page footer says "Powered by Testflow" (small, links to testflow.com.ng). Studio plans may hide it if the plan entitlement `removeBranding` is true.

## 6. Their students should feel it is theirs

- Public site and student portal responses include the brand (name, logo, colours, font) so the frontend themes every tenant page.
- Emails sent to an organisation's students use the organisation's name and reply-to (`emailBrand`), not Testflow's.
- Student accounts are per organisation (membership), but sign-in on a tenant hostname must not show Testflow's other products.

## 7. Onboarding and sign-in (what the frontend now does)

1. A signed-in Testflow user who clicks "Create account" on Testflow for Everyone sees an **Authorize** screen (no sign-up form).
   Authorize calls `POST /auth/memberships { product: "everybody", profile: { organizationName: "<First name>'s CBT" } }` with the session.
   The real name is asked next, so the placeholder only has to pass the 2 to 120 character rule.
2. Setup wizard (no landing page): **Name** then **Logo**, **Domain**, **Wallet** (the last three can be skipped).
   - Name: `GET /domains/check-subdomain?name=`, then `POST /organizations { name, slug }` and `POST /organizations/:id/domains { type: "subdomain", hostname: "<slug>.testflow.com.ng" }`. The membership's placeholder `organizationName` should be replaced by the organisation's real name.
   - Logo: `POST /organizations/:id/site/assets`, then `PATCH /organizations/:id/site { brand: { name, logoUrl } }`; the wizard calls `POST .../site/publish` at the end.
   - Domain: `POST /organizations/:id/domains { type: "custom", hostname }`.
   - Wallet: `GET /banks`, `POST .../payout/verify`, `PUT .../payout` (section 4).
3. Skipped steps are reminders on the workspace Overview (derived from site, domains and `payout.status`); nothing else is needed from the backend.
4. "Back to Testflow" calls `POST /auth/switch-product { product: "student" }` so one session serves both products.
5. Signing in on Testflow for Everyone with an account that has no membership (`403 NO_MEMBERSHIP`, `canJoin`) signs the user in as a normal student, then shows the same Authorize screen.

**Tenant hostnames (needed next).** `https://grace.testflow.com.ng` and custom domains should open that organisation's own **sign-in / create-account page** (branded with its name and logo), and after creating an account the student lands on that organisation's site. Please support: resolving the tenant from `Host` (`GET /api/v1/public/site`), a tenant-scoped sign-up that creates an `OrgMembership` (role student) instead of a product membership, and returning the tenant `meta` for the share image (section 5).

## 8. Tenant site API (what the frontend calls on `grace.testflow.com.ng` or a custom domain)

When the page is opened on an organisation's own address, the whole frontend becomes that organisation's site (its brand, its own sign-in and
sign-up, its student home). The API is on another origin, so the frontend sends the tenant's address as **`X-Tenant-Host: <hostname>`** on every call
below; the backend must resolve the organisation from it (and may cross-check `Origin`). Unknown or suspended hosts return `404 TENANT_NOT_FOUND`.

| Call | Purpose |
|---|---|
| `GET /api/v1/public/site` | `{ organization: { name, slug }, site: { brand, pages, portal, ... published }, meta }` |
| `GET /api/v1/public/auth/me` | the signed-in student of this organisation, `401` if none |
| `POST /api/v1/public/auth/register` `{ fullName, email, password }` | creates the account **and an `OrgMembership` (student)** for this organisation, signs the student in (cookie), `409 EMAIL_TAKEN` if that email already has an account here |
| `POST /api/v1/public/auth/login` `{ email, password }` | `401 INVALID_CREDENTIALS`; signs in only students of this organisation |
| `POST /api/v1/public/auth/logout` | |
| `GET /api/v1/public/exams` | published exams of this organisation (`{ items: [{ id, title, questionCount, durationMinutes, priceMinor }] }`) |

- A student account on one organisation must not be usable on another, and must not see Testflow's own products.
- The session cookie for a custom domain must be scoped to that domain (first party), not to `.testflow.com.ng`.
- Starting and taking an exam on the tenant site is the next phase; the frontend keeps the Start button disabled until those endpoints exist.
- Test in dev with `http://localhost:5174/?tenant=grace` (the frontend pretends to be `grace.testflow.com.ng`; `?tenant=off` goes back to Testflow).

## 9. Simplified product model (supersedes earlier notes where they conflict)

**Students pay for one thing only: an exam the organiser chose to charge for.** There is no Student Pass, no ad-removal purchase and (for now) no paid
books on a tenant site. Section 3 (paid Library) is postponed; the Library and the page editor are switched off in the frontend.

**Ads follow the organiser's plan, not the student.** Pro shows small ads to the organisation's students; Studio shows none. `GET /api/v1/public/site`
must include `site.ads`: `{ enabled: boolean, publisherId, slots: { portal_home, before_corrections } }`, with `enabled: false` on Studio, on an expired
workspace and for any exam page. The frontend renders only the two placements below, and never inside an exam or a live sitting:
`portal_home` (bottom of the student home page) and `before_corrections` (a 5-second card before the corrections, skipped when `enabled` is false).

**Exam fields** (create/update `POST|PATCH /organizations/:id/exams`, read `GET .../exams/:examId`):
`title, instructions, mode: 'anytime'|'live', startsAt (ISO, live only), durationMinutes, priceMinor (0 = free), access: 'link'|'invited'|'code', accessCode,
showCorrections: 'now'|'after_exam'|'never', shuffleQuestions, shuffleOptions, negativeMarking, attemptsAllowed, status, questionCount`.
- **Live CBT:** every student starts at `startsAt`; the join page waits until then and the clock is the server's. Reuse the live-CBT room machinery where possible.
- Publishing a paid exam without an active payout account returns `422 PAYOUT_REQUIRED`.

**Questions belong to an exam.** `GET|PUT .../exams/:examId/questions` (PUT body `{ questionIds: [] }` replaces the list and its order).
`POST .../questions` and `POST .../questions/bulk` accept `?examId=` / body `examId` to add to an exam in one step; the org question bank stays as a reusable pool.

**Records for the organiser**
- `GET .../exams/:examId/results` returns `{ items: [{ id, studentName, email, scorePercent, correct, total, timeMinutes, submittedAt }], summary: { attempts, average, highest, lowest } }`.
- `GET .../students` adds `attempts` (exams taken) and `average` per student; `GET .../students/:studentId` returns `{ student, attempts: [{ id, examTitle, scorePercent, correct, total, submittedAt }] }`.

**Announcements** are `community/posts` with `type: 'announcement'` (create, pin, hide, delete). Students see them on the tenant home page: `GET /api/v1/public/announcements`.

**What students see after an exam (tenant side)**
- `GET /api/v1/public/results` and `GET /api/v1/public/results/:id`. The detail returns `corrections` **only if the exam's `showCorrections` allows it right now** (`now`, or `after_exam` once the exam has closed); otherwise `corrections: null`. The backend must enforce this, not the UI.

**Colours.** `brand.primaryColor` and `brand.accentColor` (already in the site config) now have a picker on the Name and domain page; publishing applies them to every tenant page.

## 10. Plan upgrades go straight to payment

The Plan page has no confirmation dialog. "Upgrade to remove ads", "Switch to <plan>" and "Renew early" call the subscription endpoints from `docs/everybody/IMPLEMENTATION.md` section 16 and send the organiser to Paystack:
- `POST /subscriptions/:id/upgrade { planKey }` (with `Idempotency-Key`) returns `{ paymentId, reference, amountKobo, currency, authorizationUrl }` for the prorated difference; a **downgrade** returns `200 {}` with no `authorizationUrl` (it is scheduled for period end) and the UI says so.
- `POST /subscriptions/:id/renew` returns the same checkout shape.
- The payment's **callback URL must be `<client>/workspace/billing/complete`** (Paystack appends `?reference=` and `trxref=`). That page polls `GET /payments/verify?reference=` and shows paid, pending or failed. `status: 'paid'` must already reflect the activated plan.

## 11. Earnings page and invoices

`GET /organizations/:id/payments` must return, per payment, enough to print a receipt: `{ id, reference, paidAt, item (exam title), studentName, grossKobo, platformFeeKobo, orgShareKobo, status: 'paid'|'refunded'|'failed' }`.
The page loads up to 500 payments (`?limit=500`) and builds the totals, the daily chart, the "where it comes from" list, the PDF statement and the CSV in the browser, so please also support `?from=&to=` (ISO dates) and paginated export for very large histories. If you prefer server-side documents, add `GET .../payments/statement.pdf?from=&to=` and `GET .../payments/:id/receipt.pdf`; the frontend will switch to them.
Totals count only `paid` payments; refunded and failed ones are listed but excluded.

## 12. Live CBT is a Studio-only feature

| | Pro | Studio |
|---|---|---|
| Anytime exams, question banks, paid exams | yes | yes |
| **Live CBT** (everyone starts together at a set time) | **no** | **yes** |
| Ads shown to the organisation's students | yes | no |

- Add an entitlement `liveCbt` to plan definitions (`PlanDefinition.entitlements.liveCbt`): `false` on Pro, `true` on Studio. Return it in `GET /subscription` as `subscription.entitlements.liveCbt` (the frontend reads it, and falls back to "plan is Studio" until it exists).
- **Enforce in the service, not the UI:** creating or updating an exam with `mode: 'live'`, publishing a live exam, and starting a live sitting all return `402 PLAN_REQUIRED` with `details: { feature: 'live_cbt', requiredPlan: 'studio' }` when the organisation does not hold the entitlement.
- **Downgrade or expiry (Studio to Pro):** existing live exams stay visible and editable but cannot be published or started. Live sittings already in progress may finish. A live exam scheduled in the future is automatically unpublished when the downgrade takes effect, and the organiser is told. The frontend shows "This exam is a Live CBT, which is part of the Studio plan" with an upgrade button.
- Switching an exam from `live` to `anytime` is always allowed.
- The frontend hides Live CBT behind a "Studio" badge on Pro, in the New exam dialog and in the exam's Rules.

## 13. Three plans: Free, Pro, Studio (replaces the plan table in section 12)

| Feature | Free | Pro | Studio |
|---|---|---|---|
| CBT site on testflow.com.ng, name, logo, colours | yes | yes | yes |
| Anytime exams | **max 3** | unlimited | unlimited |
| Question banks | no | yes | yes |
| Announcements | no | yes | yes |
| Reported questions (student flags) | no | yes | yes |
| **Charge for exams (paid to the organiser's account), earnings, payout** | no | no | **yes** |
| **Live CBT** | no | no | **yes** |
| Ads for the organiser's students | shown | shown | none |

Pro is the simple, fast plan. Free is a trial. Studio is for organisers who earn money or run live sittings.

**Backend work**
- Every organisation always has a subscription. Free is `planKey: 'free'`, `priceMinor: 0`, no `currentPeriodEnd`, never expires. Include it in `GET /plans` (the frontend adds a Free card itself if missing). New organisations start on Free. Upgrading goes to payment as before.
- `subscription.entitlements`: `{ maxExams: 3 | null, questionBanks, announcements, reports, paidExams, liveCbt }` (booleans, `null` means unlimited). The frontend uses these and falls back to the plan name.
- Enforce in the service with `402 PLAN_REQUIRED` and `details: { feature, requiredPlan }`: `exam_limit` (4th exam on Free, `maxExams`), `question_banks`, `announcements`, `reports`, `paid_exams` (setting `priceMinor > 0` or publishing a paid exam, payout setup, earnings and statement endpoints), `live_cbt`.
- Free also shows ads (`site.ads.enabled: true`), same as Pro.
- **Downgrade:** nothing is deleted. Existing exams beyond 3 stay, but the organiser cannot create more and cannot publish more than 3 at once (oldest published stay live). Banks, announcements and flags become read-only. A paid exam on a plan without `paidExams` is unpublished and students cannot buy it. Money already earned stays withdrawable; payments from students already in flight finish.
- Students who already bought a paid exam keep access.

The frontend shows locked features (visible but dimmed, with an upgrade card) instead of hiding them.
