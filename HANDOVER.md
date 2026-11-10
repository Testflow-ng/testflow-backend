# TestFlow — Engineering Handover (PR-style summary)

**Session:** 2026-11-09  
**Author:** Kilo (autonomous engineering agent)  
**Branches:** frontend `redesign`; backend main-equivalent (reset to `5f026ab`)  
**Status:** Work in progress — NOT committed, NOT pushed. Local environment files (`.env.test`) intentionally NOT committed.

---

## 1. STATE OF REPOS (as of handover)

### Backend (`/home/emerald/Desktop/testflow-backend`)
- `git status`: 26 tracked files modified + 4 untracked (`docker-compose.test.yml`, `scripts/test-db-reset.mjs`, `scripts/test-db-status.mjs`, `tests/_env.test.js`).
- `npm run lint` (`eslint src`): **CLEAN** (0 errors).
- `npm run test:unit`: **91 tests, 24 suites, 91 pass, 0 fail** (green).
- `npm test` full serial run: previously timed out at 600s because integration suites are slow (~60-100s each); NOT a failure.
- Integration suites run individually — all **PASS** so far (each ~60-100s against real MongoDB):
  - `everybody.integration.test.js` — 6 pass (orgs, members, invitations, cross-tenant IDOR)
  - `orgStudents.integration.test.js` — 7 pass
  - `entitlements.integration.test.js` — 19 pass
  - `orgSubscriptionPayments.integration.test.js` — 6 pass (checkout/renew/webhook/idempotency/plan enforcement)
  - `orgExamFlow.integration.test.js` — **11 pass / 1 FAIL** (see section 4)
  - `liveCbt.integration.test.js` — **FAILS at ~94s** (`MongoNetworkError: connection closed`) — needs investigation
  - Remaining suites not yet completed individually: `ads`, `advertising`, `subscription`, `library`, `paystackWebhookDispatch`, `feedback`, `identity`, `cbtPayload`, `study`, `leaderboard`

### Frontend (`/home/emerald/Desktop/testflow-frontend`)
- `git status`: 3 tracked files modified + 2 untracked (`src/features/billing/BillingCheckoutPage.jsx`, `src/features/workspace/screens/BillingCheckoutScreen.jsx`).
- `vite build`: **SUCCEEDS** (`dist/sw.js`, `dist/workbox-*.js`, 243 precache entries). Chunk-size warning only.
- Targeted ESLint on modified files (`TenantExamPage.jsx`, `ExamDetailScreen.jsx`): **CLEAN**.
- Full frontend ESLint: **NOT green** (many pre-existing unrelated errors; earlier full runs timed out).
- `vitest`: **NOT installed** (`node_modules/vitest` missing). Frontend test suite not runnable yet.
- Untracked checkout screens: **PRESERVED, NOT routed, NOT integrated** (see section 6).

### Local MongoDB test environment (WORKING)
- `docker-compose.test.yml`: `mongo:7.0`, container `testflow-mongo-test`, bind `127.0.0.1:27018:27017`, volume `testflow_mongo_test_data`, `restart: unless-stopped`, healthcheck, `MONGO_INITDB_DATABASE=testflow_test`.
- `.env.test` (gitignored): `MONGODB_URI_TEST=mongodb://127.0.0.1:27018/testflow_test?directConnection=true` (dedicated, separate from dev/prod `MONGODB_URI`), `NODE_ENV=test`, test JWT secrets, external services disabled.
- `package.json` scripts added: `test`, `test:unit`, `test:integration`, `test:db:up`, `test:db:down`, `test:db:status`, `test:db:reset`.
- Scripts: `scripts/test-db-status.mjs`, `scripts/test-db-reset.mjs` (reset refuses non-local host, refuses non-test DB names, refuses `MONGODB_URI_TEST === MONGODB_URI`).
- `tests/_env.test.js`: optional dotenv bootstrap for direct test runs.
- Container status at handover: `testflow-mongo-test` **Up 10 minutes (healthy)**.
- `README.md` updated with full local MongoDB test setup/commands/coverage notes.
- `.gitignore` appended: `test-results/`, `docker-compose.override.yml`.

---

## 2. WHAT WAS DONE (completed & verified)

### A. Security incident cleanup (obfuscated payloads)
- Removed appended payload marker `global.o='5-1517-du'` / `_$_61aa`-style blobs from backend `src/server.js` and seed/scripts, and frontend `postcss.config.mjs`.
- `rg` scans found no remaining marker in `src`/configs of either repo.
- NOTE: payloads still exist in **commit history** (backend `5f026ab`, frontend `530cc3a`). History/deployment review + credential rotation recommended if exposure possible. No history rewrite performed.

### B. Backend lint/parse fixes
- `adminAds.controller.js`: added missing `AppError` import.
- `tenant.controller.js`: removed unused `activeProduct`.
- `verification.routes.js`: removed unused multer/path import (parse fix).
- `fcm.service.js`, `ads/houseAds.service.js`, `avatar.service.js`, `validators/auth.schema.js`, `scripts/test-verification-logic.js`: lint fixes.
- Scripts: cleaned unused `createRequire` imports (kept required `fileURLToPath`).

### C. Frontend fix
- `ExamDetailScreen.jsx`: restored required lucide icons (`Calendar, CreditCard, Eye, Users, Sliders, ShieldCheck`); removed unused imports/constant. Targeted lint clean.

### D. Exam resume integrity (backend + frontend)
- Backend `src/services/orgExamSitting.service.js` `toSittingView()`: now returns `answers[{questionId, selectedIndex}]` for selected choices only (no correctness leakage), so resuming an in-progress paper restores the student's selections.
- Frontend `src/features/tenant/TenantExamPage.jsx`: hydrates `answers` from resumed attempt; clearer `EXAM_NOT_STARTED`/`EXAM_CLOSED` error messaging.
- Backend unit + lint still green; frontend build still succeeds.

### E. Expired-subscription write gating (service layer)
Added `requireWritableSubscription(orgId)` to mutation services so an org whose **paid subscription has expired** cannot perform paid-feature writes (free orgs / never-paid orgs remain writable):
- `orgContent.service.js`: `createExam`, `updateExam`, `setExamPublished`/unpublish, `deleteExam`, `createQuestion`, `updateQuestion`, `deleteQuestion`, `bulkQuestions`, `createBank`, `updateBank`, `deleteBank`, `createBook`, `updateBook`, `deleteBook`, `setStudentStatus`, `createPost`, `updatePost`, `deletePost`, `updateFlag`, `importQuestionRows`.
- `orgSite.service.js`: `patchSite`, `publishSite`, `uploadSiteAsset` (made async — all 3 controller callers already `await` it).
- `orgStudents.service.js`: `addStudents`.
- `orgDomain.service.js`: `addDomain`, `verifyDomain`, `removeDomain`.
- `orgMoney.service.js`: `savePayout`.
- `orgSubscription.service.js`: `createSubscription`, `updateSub`, `upgradeSubscription`, `renewSubscription`, `startSubscriptionCheckout`, `getCheckoutByReference`.
- `orgStudentPayments.service.js`: `initializeExamCheckout` (also requires Studio + payout), `verifyExamPayment`, `refundOrgPayment`.
- Webhooks intentionally NOT gated (server-to-server signature-checked); `handleOrgPaymentWebhook` payment lookup left by reference (low risk).

### F. Local test environment provisioning
- Persistent MongoDB 7 via Docker Compose (local-only `127.0.0.1`), named volume, auto-restart.
- `.env.test` with dedicated test DB URI, safe placeholder values, no production credentials.
- Test DB helper scripts with safety guards.
- `npm run test:db:up / :status / :reset / :down`.
- Documented in `README.md`.

---

## 3. KNOWN FAILURES / BLOCKERS (must be fixed before "done")

### 1. `orgExamFlow.integration.test.js` — 1 real failure (FIXABLE)
**Test:** "another tenant gets 404 for an attempt and an exam it does not own" (line 467).  
**Error:** `TypeError: Cannot read properties of undefined (reading 'id')` at line 475 — `start.json.attempt` is undefined when studentA starts exam.  
**Likely cause:** `startExam` returned a non-201/error body (no `attempt` key). Could be a publish/start issue under the new gating, or a helper returning `undefined` exam. Needs debugging against real DB.  
**Files:** `tests/orgExamFlow.integration.test.js:467-488`, backend `src/services/orgExamSitting.service.js` `startAttempt`, `src/controllers/tenant.controller.js` `startExam`.

### 2. `liveCbt.integration.test.js` — connection closed at ~94s
**Error:** `MongoNetworkError: connection 3 to 127.0.0.1:27018 closed`. Likely a WebSocket/server not closing cleanly or Mongo connection pool exhaustion during the live-CBT socket test.  
**Files:** `tests/liveCbt.integration.test.js`, `src/sockets/liveCbt.socket.js`, `src/server.js`. Needs investigation.

### 3. Remaining integration suites not yet run individually
`ads`, `advertising`, `subscription`, `library`, `paystackWebhookDispatch`, `feedback`, `identity`, `cbtPayload`, `study`, `leaderboard` — need to be executed against the now-healthy MongoDB. (Each ~60-100s.)

### 4. Frontend test setup NOT restored
- `vitest` missing from `node_modules`. `package.json` declares it but binary not resolvable.
- No `vitest.config.*`, no jsdom/happy-dom env, minimal existing test files (`BillingCompleteScreen.test.jsx`, `BillingScreen.test.jsx` reference `vi.fn()` — vitest-style).
- Need: `npm install`/restore vitest deps, add vitest config + test script, get `npm run test` (frontend) green.

### 5. Integration coverage gaps (identified by security audit)
- `listStudents` cross-org user enumeration: `User.find({ $or: [{fullName},{email}] })` not org-scoped before membership filter (`src/services/orgContent.service.js` listStudents).
- Subscription payment lookups find by reference before org scoping (`orgSubscription.service.js` `getSubscriptionPaymentStatus`/`getCheckoutByReference`) — functionally blocked by `assertPaymentAccess` membership, but less defense-in-depth.
- Audit log (`audit.service.js` `recordAction`) not tenant-partitioned (no `organization` field).
- These are **defense-in-depth enhancements**, not blocking failures.

---

## 4. INTEGRATION TEST RESULTS SUMMARY (run individually vs real MongoDB)

| Suite | Result |
|-------|--------|
| everybody | 6 pass ✓ |
| orgStudents | 7 pass ✓ |
| entitlements | 19 pass ✓ |
| orgSubscriptionPayments | 6 pass ✓ |
| orgExamFlow | 11 pass / 1 FAIL (cross-tenant attempt) |
| liveCbt | FAIL (Mongo connection closed @94s) |
| ads | not yet run |
| advertising | not yet run |
| subscription | not yet run |
| library | not yet run |
| paystackWebhookDispatch | not yet run |
| feedback | not yet run |
| identity | not yet run |
| cbtPayload | not yet run |
| study | not yet run |
| leaderboard | not yet run |

---

## 5. COMMERCIAL / PAYMENTS (Workstream D) — audited, NOT E2E-verified

### Org student paid-exam flow (`src/services/orgStudentPayments.service.js`)
- Price read from published exam (never from request).
- Paystack initialized with org's own subaccount (split at source).
- Amounts frozen onto payment row at settlement.
- Access granted only after provider confirmation (`verifyOrgTransaction`).
- Idempotency key support; redelivered webhook = no-op.
- Tenant controller: `checkoutExam` / `verifyPayment` / `paymentWebhook` (signature-checked, server-to-server).
- **BLOCKED from true E2E:** no real Paystack test/live credentials, no webhook callbacks, no subaccount/5% fee settlement verification.

### Org plan checkout/renew/verify/webhook (`src/services/orgSubscription.service.js`, `everybody.subscription.routes.js`, `controllers/organization.controller.js`)
- Bank-transfer default; checkout redirect as compatibility path.
- Prorated upgrade; scheduled downgrade (no charge now).
- Payment activates subscription only after provider confirmation; re-verify/webhook never extends twice.
- `settlePaid`/`activate` with amount/currency match check.
- `handleSubscriptionWebhook` with `processedEventIds` dedupe.
- **BLOCKED from true E2E:** no real Paystack credentials/webhook.

### Contract mismatch identified (frontend `BillingCheckoutScreen.jsx`)
- Screen reads top-level `payment.accountNumber/bankName/accountName/expiresAt`; backend `verifySubPayment` `paymentView` nests these under `payment.transferInstructions.*`. Screen's `payment.accountExpiresAt` doesn't match backend `transferInstructions.expiresAt`. Needs normalization wrapper or screen field-access fix before wiring.

---

## 6. UNINTEGRATED / UNTRACKED FILES (preserved, decisions pending)

**Frontend (untracked — do NOT delete):**
- `src/features/billing/BillingCheckoutPage.jsx` (227 lines)
- `src/features/workspace/screens/BillingCheckoutScreen.jsx` (205 lines)
- `BillingCheckoutScreen`: reads `reference`/`trxref` from URL or `localStorage['testflow:pendingWorkspacePurchase']`; polls `wsApi.verifyPayment(reference)` every 8s; handles `paid/expired/abandoned/failed/refunded`.
- **NOT routed** in `src/routes/router.jsx` (`/workspace/billing/checkout` missing).
- **Contract mismatch** with backend `verifySubPayment` (see section 5).
- Recommendation: wire under `/workspace/billing/checkout`, reconcile field access (`transferInstructions.*`), coexist with existing `BillingScreen` checkout flow. Do NOT wire until contract is fixed and E2E payment flow is verified.

**Backend:** no unintegrated checkout files; all payment routes exist but lack real provider credentials.

---

## 7. FEATURE FLAGS (workspaces)
- `WEBSITE_EDITOR_ENABLED = false`, `LIBRARY_ENABLED = false` (`src/features/workspace/flags.js`).
- Full `WebsiteScreen.jsx` / `LibraryScreen.jsx` + backend `orgSite`/`library` services+routes exist but are behind flags.
- **Enabling requires:** verified backend flows + frontend QA (responsiveness/a11y/states). Not done yet.

---

## 8. NEXT STEPS FOR SOMEONE TAKING OVER (in order)

1. **Fix `orgExamFlow` cross-tenant attempt failure** (1 test) — debug why `start.json.attempt` is undefined; likely a publish/start path issue. Backend + test.
2. **Fix `liveCbt` Mongo connection close** — investigate socket/server teardown.
3. **Run remaining integration suites** (`ads`, `advertising`, `subscription`, `library`, `paystackWebhookDispatch`, `feedback`, `identity`, `cbtPayload`, `study`, `leaderboard`) against healthy MongoDB; fix genuine failures (no mocks, no disabling, no security weakening).
4. **Add missing integration coverage** for tenant isolation, org/memberships, subscriptions, entitlements, payments, domains, student records, exam attempts (real DB, no mocks).
5. **Restore frontend test setup:** install vitest, add vitest config/jsdom, add test script, get `npm run test` (frontend) green.
6. **Frontend QA:** responsive (320–1440+), accessibility, loading/empty/error states across all workspace/tenant routes.
7. **Enable Website/Library** only after backend + frontend QA passes (flags in `src/features/workspace/flags.js`).
8. **Wire `BillingCheckoutScreen`** only after contract mismatch fixed and payment E2E verified with real/sandbox Paystack.
9. **Security audit defense-in-depth:** org-scope `listStudents` user search; scope subscription payment finds by org; tenant-partition audit log (optional enhancements).
10. **Final:** `npm run lint` + full `npm test` (backend) green; frontend build + test green; MongoDB persists across restart (`docker restart testflow-mongo-test`).

---

## 9. HOW TO CONTINUE (immediate commands)

```bash
# Backend (from /home/emerald/Desktop/testflow-backend)
docker compose -f docker-compose.test.yml up -d --wait        # ensure Mongo up
npm run test:db:status                                        # verify DB
npm run test:unit                                             # 91 pass, 0 fail
npx --no-install eslint src                                   # clean
# Run each integration suite individually (~60-100s each):
timeout 150 bash -c 'node --env-file=.env.test --test --test-concurrency=1 tests/NAME.integration.test.js'

# Frontend (from /home/emerald/Desktop/testflow-frontend)
node ./node_modules/vite/bin/vite.js build                    # succeeds
```

---

## 10. BOUNDARIES RESPECTED
- No production credentials used in `.env.test` (placeholders only).
- No destructive production migrations.
- No commercial pricing/subscription business-rule changes.
- No analytics implemented.
- No history rewrite (obfuscated payloads remain in git history).
- No commits/pushes made.
- Untracked checkout screens preserved.
- `.env.test` / secrets not committed.
