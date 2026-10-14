# Centralized identity — design note

**Goal:** one TestFlow account per person, usable across products (student CBT, Ads, future ones) with a single sign-in.

## Model
- **One `User` per email** (already unique). `User.memberships[] = {product, role, joinedAt}`; products today: `student` (role `student`) and `ads` (role `advertiser`). New product = one entry in `src/utils/identity.js` `PRODUCTS`.
- `User.role` is now only the **global** level: `student` (default for every non-admin), `admin`, `super_admin`. Admin roles stay global and carry no product memberships. Legacy `advertiser` is converted by the migration.
- `hasMembership(user, product, role?)` replaces single-role checks. Un-migrated accounts get memberships **derived from `role`**, so nothing breaks before the migration is run. Routes use `requireMembership('ads')` / `requireMembership('student')`; admin routes keep `authorize('admin')`.
- **Active product** (`ap` claim in both tokens) = the context the UI is in. It is informational/default for the app shell; access is always decided by memberships. `switch-product` re-issues cookies with a new `ap`, no sign-out.

## Session & cookies
Same httpOnly `tf_access` / `tf_refresh` cookies, `SameSite=Lax`, `Secure` in production. `COOKIE_DOMAIN=.testflow.com.ng` shares them across all subdomains (testflow.com.ng, ads.testflow.com.ng). A readable `tf_csrf` cookie carries the CSRF token.

## Other domains: authorization code + PKCE
`POST /auth/oauth/authorize` (signed-in user) → one-time code (hashed, 2 min, single-use) for an allow-listed `clientId` + **exact** `redirectUri` (`AUTH_CLIENTS`). `POST /auth/oauth/token` with the PKCE `codeVerifier` (S256) → short-lived **Bearer** access token (revoked by logout/password reset). No refresh token: the client re-runs authorize while the user's TestFlow session lives.

## Security decisions
- **CSRF:** a shared cookie across subdomains defeats SameSite=Lax (sibling subdomains are same-site), so: (1) an unsafe request with an `Origin` outside the allow-list is always refused (`CSRF_ORIGIN`); (2) while a session cookie is present the `X-CSRF-Token` header must equal the `tf_csrf` cookie. (2) runs in `CSRF_TOKEN_MODE` = `log` by default so existing frontends keep working — **flip to `enforce` once the frontends send the header**. Login/register/reset/token endpoints and Bearer calls are exempt from (2); the payment webhook is exempt entirely.
- **Enumeration:** login always does a bcrypt compare (dummy hash for unknown emails); forgot-password / resend-verification answer identically and never faster than 400 ms; mail is sent without being awaited. Register still reports `EMAIL_TAKEN` (needed UX; rate limited).
- **Rate limits (shared across instances, MongoDB):** login 10 / 15 min per IP+email and 50 / 15 min per IP; register 15 / h; forgot/reset/verify/resend 6 / h per IP+email; refresh 5 / 15 min; OAuth endpoints 30 / 15 min.
- **Password reset / change** bump `tokenVersion` ⇒ every session on every product and every bearer token dies.
- **Audit:** `AUTH_REGISTER`, `AUTH_LOGIN`, `AUTH_LOGIN_FAILED` (email stored only as a short hash), `AUTH_LOGOUT`, `MEMBERSHIP_ADD`, `PRODUCT_SWITCH`, `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET`, `PASSWORD_CHANGE`, `OAUTH_CODE_ISSUED`, `OAUTH_TOKEN_ISSUED`.
- **Joining a product** needs proof of account ownership: an existing session, or email+password in the same request. It is atomic (a product can be added once).

## Migration (`node src/scripts/migrate-memberships.js [--dry-run]`)
Idempotent. `student` → `student` membership; `advertiser` → `ads` membership and role becomes `student`; admins untouched; accounts that already have memberships are skipped. An `AdvertiserProfile` on an account **without a verified email** is reported for review and never linked. Accounts are never merged (email is already unique).

## Backward compatibility
`/api/ads/auth/*` remain thin wrappers (same bodies, response keeps `{user, profile}` + new fields; no-ads-membership is now `403 NO_MEMBERSHIP`, previously `NOT_AN_ADVERTISER`). `/api/auth/*` responses are supersets of the old ones. Admin student statistics/lists now select students by membership (ads-only accounts are excluded, as before).
