# Centralized identity — frontend handoff

Base `/api`. Send `credentials: 'include'` (cookies). Errors: `{ "error": { "code", "message", "details"?, "fields"? } }`. Full contract: Swagger → tags **Authentication** and **Identity**.

## Objects
```jsonc
// AccountPayload (register→no, login / refresh / me / memberships / switch-product / ads wrappers → yes)
{
  "user": { "id", "fullName", "email", "role": "student|admin|super_admin", "memberships": [...], ... },
  "memberships": [ { "product": "student", "role": "student", "joinedAt": "ISO|null" }, { "product": "ads", "role": "advertiser", "joinedAt": "…" } ],
  "activeProduct": "student" | "ads" | null,
  "profiles": { "student": { "username", "level", "department", "streakCount", "hasMigrated" }, "ads": { "businessName", "contactPhone" } },
  "csrfToken": "64-hex"        // same value as the readable tf_csrf cookie
}
```
Products: `student`, `ads`. Only memberships that exist appear in `memberships`/`profiles`.

## CSRF (do this in your fetch/axios wrapper)
For every POST/PATCH/PUT/DELETE: header `X-CSRF-Token: <tf_csrf cookie value or csrfToken from the last auth response>`. Today the server only warns if it is missing (`CSRF_TOKEN_MODE=log`); it will be switched to `enforce`. Requests from an origin that is not allow-listed get `403 CSRF_ORIGIN`. Add `X-CSRF-Token` and `Idempotency-Key` to any CORS proxy allow-lists.

## Endpoints
| Call | Body | Success | Errors |
|---|---|---|---|
| `POST /auth/register` | `{fullName,email,password,confirmPassword,product?="student",profile?:{businessName,contactPhone?}}` (`profile.businessName` required when `product:"ads"`) | **201** `{user, memberships}` — does **not** sign in | 422 `VALIDATION_ERROR` (+`fields`) · 409 `EMAIL_TAKEN` `details:{product,canJoin:true,hint}` · 429 `RATE_LIMITED` |
| `POST /auth/login` | `{email,password,product?}` | **200** AccountPayload + cookies | 401 `INVALID_CREDENTIALS` (identical for unknown email/wrong password) · **403 `NO_MEMBERSHIP`** `details:{product,canJoin:true}` (no session is created) · 429 |
| `GET /auth/me` | – | 200 AccountPayload + `meta:{needsUsername}` | 401 `UNAUTHENTICATED` |
| `POST /auth/refresh` | – (refresh cookie) | 200 AccountPayload (keeps `activeProduct`) | 401 `INVALID_REFRESH` |
| `POST /auth/logout` | – | 204 (signs out **all** devices) | 401 |
| `POST /auth/memberships` | `{product, profile?}` + session, **or** `{product, profile?, email, password}` with no session | **201** AccountPayload (signed in, `activeProduct` = product) | 401 · 409 `ALREADY_MEMBER` · 422 (ads needs `profile.businessName`) |
| `POST /auth/switch-product` | `{product}` | 200 AccountPayload (same session, new context) | 403 `NO_MEMBERSHIP` |
| `POST /auth/forgot-password` | `{email}` | 200 same message always (≥400 ms) | 429 |
| `POST /auth/reset-password` | `{token,password}` | 200; **signs out every session** | 400 `INVALID_OR_EXPIRED_TOKEN` |
| `POST /auth/change-password` | `{currentPassword,newPassword}` | 200; signs out every session | 400 `INVALID_PASSWORD` |
| `POST /ads/auth/register` *(legacy wrapper)* | `{fullName,email,password,confirmPassword,businessName,contactPhone?}` | **201** AccountPayload + `profile` + cookies | as register (409 → use memberships) |
| `POST /ads/auth/login` *(legacy wrapper)* | `{email,password}` | 200 AccountPayload + `profile` | 403 `NO_MEMBERSHIP` if no ads membership |
| `GET /ads/auth/me` | – | 200 AccountPayload + `profile` | 403 `NO_MEMBERSHIP` |

### Recommended flows
- **"Sign in to Ads"**: `login {product:"ads"}`. On `403 NO_MEMBERSHIP` with `canJoin`, show "Add Ads to your TestFlow account" (collect business name) → `POST /auth/memberships {product:"ads", profile, email, password}` (or without email/password if already signed in elsewhere).
- **Product switcher**: render from `memberships`; call `switch-product`; read `activeProduct`.
- **Same session across subdomains** works once `COOKIE_DOMAIN=.testflow.com.ng`: call `GET /auth/me` on load of any product app.

## Other domains (no shared cookie)
1. Generate `codeVerifier` (43–128 chars `A-Za-z0-9-._~`) and `codeChallenge = base64url(SHA-256(codeVerifier))`.
2. User signs in on testflow (cookie session) → `POST /auth/oauth/authorize {clientId, redirectUri, codeChallenge, codeChallengeMethod:"S256", state?, product?}` → `200 {redirectTo}`; navigate to `redirectTo` (it carries `?code=…&state=…`).
3. Your server/app: `POST /auth/oauth/token {grantType:"authorization_code", code, codeVerifier, clientId, redirectUri}` → `200 {accessToken, tokenType:"Bearer", expiresIn, user, memberships, activeProduct, profiles}`. Send `Authorization: Bearer <accessToken>`.
Errors: `400 INVALID_CLIENT | INVALID_REDIRECT_URI | INVALID_GRANT` (code expired/used/wrong verifier — codes are single-use), `403 NO_MEMBERSHIP`, `401`. Clients must be registered by an admin in `AUTH_CLIENTS` (exact redirect URIs, https).

## Operational notes
- Production: `COOKIE_DOMAIN=.testflow.com.ng`, `CSRF_TOKEN_MODE=log` → `enforce` after rollout, `ALLOWED_ORIGINS=https://ads.testflow.com.ng,<swagger docs origin>` (+ `CLIENT_URL`/`ADS_CLIENT_URL`).
- Run the migration once: `node src/scripts/migrate-memberships.js --dry-run`, review, then without the flag. Not required for things to work (memberships are derived from `role` until then).
- One browser holds one session: signing into another product with a different account replaces the session.
