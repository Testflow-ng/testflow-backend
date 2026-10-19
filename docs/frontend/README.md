# Frontend contracts: index and checklist

These docs are written by the frontend work for the backend to review and build. The frontend runs on sample data today, so every item below is
**not live until the backend ships it**. Newest decisions are at the bottom of each file.

| Doc | What it covers |
|---|---|
| `FRONTEND_UPDATE.md` | Hall of Fame, optional username, Live CBT polling, Library gate pointer |
| `LIBRARY_GATE.md` | Library read/download needs the Student Pass (`library` entitlement, `402 PLAN_REQUIRED`) |
| `EVERYONE_REQUIREMENTS.md` | Testflow for Everyone: payouts and the revenue split, tenant sites and share images, onboarding, tenant API, simplified product model, plan upgrades, earnings and invoices, Live CBT Studio-only |
| `EVERYONE_EXAMS_SPEC.md` | Exams, question banks, results, flags, corrections visibility, live mode, announcements (review this one first) |

## Backend checklist (tick as you build)

**Testflow (students)**
- [x] `GET /api/leaderboard` overall board, `rank` and `me` on subject boards (FRONTEND_UPDATE 1)
- [x] `library` entitlement, `402` on pages and download, backfill for existing passes (LIBRARY_GATE)
- [ ] Notification preferences sync, optional (FRONTEND_UPDATE 4). **Not built yet; no preferences store.**

**Testflow for Everyone, organiser**
- [x] Organisation create, name, logo, colours, publish (REQUIREMENTS 1, 7)
- [x] Payout: banks, account verify, Paystack sub-account, split on every payment, earnings and payments lists (REQUIREMENTS 4, 11)
- [x] Domains: subdomain check/add, custom domain DNS verify (REQUIREMENTS 5)
- [x] Exams: fields, publish rules, lock after attempts (EXAMS 1)
- [x] Question banks, questions per exam, images, CSV/ZIP import, template (EXAMS 2 and Question banks)
- [x] Results, student records page (`students/:studentId`, EXAMS end), CSV with formula-injection guard (EXAMS 3)
- [x] Question flags and edit/delete rules, incl. soft-delete (EXAMS 2, 5)
- [x] Announcements as community posts (EXAMS 8)
- [x] Plans: Free (3 exams), Pro, Studio; entitlements; ads flag; upgrade/renew/verify + webhook (REQUIREMENTS 9, 10, 12, 13)
- [x] **Live CBT is Studio only**, on create, publish and start; downgrade unpublishes future live exams (`npm run subscription:lifecycle`) (REQUIREMENTS 12)

**Testflow for Everyone, students (tenant site)**
- [x] Resolve tenant from `X-Tenant-Host`, public site, tenant sign-up/sign-in/me/logout (REQUIREMENTS 8)
- [x] Exam list, results and corrections with `showCorrections` enforced incl. `hidden` and `score_only` (EXAMS 4)
- [x] Flag a question (EXAMS 5)
- [x] Take an exam on the tenant site, free or paid via Paystack split checkout (EXAMS 6, 7). **Not built in the frontend yet.**
- [x] Server-rendered share tags (`og:title`, image) for tenant hostnames (REQUIREMENTS 5)

## Product rules the frontend assumes
1. Students pay for one thing only: an exam the organiser charges for (Studio plan). No student pass or ad-removal on tenant sites.
2. Ads follow the organiser's plan: Pro shows small ads (home page, 5 seconds before corrections), Studio shows none. Never in an exam or live sitting.
3. Three plans: Free (3 exams, trial), Pro (simple and fast, banks and announcements), Studio (paid exams, Live CBT, no ads). Locked features stay visible with an upgrade card.
4. Organisers can change name, logo, colours and domain. The page editor and the organisation Library are built but switched off.

_Last updated with: Live CBT moved to Studio only, earnings and invoices, plan upgrades going straight to payment._
