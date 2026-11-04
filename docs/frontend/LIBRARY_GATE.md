# Library access is part of the Student Pass (backend must enforce it)

**Status:** the frontend is built and shows the locked state. The backend does not enforce it yet, so today
a free student could still call the API directly. Please implement everything below.

## The rule

| Action | Free student | Student with a live pass |
|---|---|---|
| Browse the shelf (`GET /api/library/books`) | yes | yes |
| Book details (`GET /api/library/books/:id`) | yes | yes |
| Bookmark a book, reading progress, "Continue reading" | yes | yes |
| **Read a book** (`GET /api/library/books/:id/pages`) | **no, `402 PLAN_REQUIRED`** | yes |
| **Download a book** (`GET /api/library/books/:id/download`) | **no, `402 PLAN_REQUIRED`** | yes |

A "live pass" means the student holds a non-revoked, non-expired `library` entitlement (computed against the
clock, exactly like `ad_free` and `live_cbt_host`).

## 1. Add the entitlement

1. `src/config/plans.js`: add `library: true` to `entitlements` of **both** `pass_30d` and `pass_90d`, and
   `library: !!plan.entitlements.library` to `toPlanView().entitlements` (as `library`).
2. `src/models/StudentEntitlement.js` and `studentPlan.service.js`: add `library` to `ENTITLEMENT_KEYS` so the
   enum, the grant, the revoke and the expiry logic cover it.
3. `studentEntitlements()` must return it, in both places the frontend reads:

```json
{
  "entitlement": {
    "status": "active",
    "adFree": true,
    "liveCbtHost": true,
    "library": true,
    "entitlements": { "ad_free": true, "live_cbt_host": true, "library": true },
    "activeKeys": ["ad_free", "library", "live_cbt_host"],
    "expiresAt": "2026-11-18T10:00:00.000Z"
  }
}
```

   The frontend reads `entitlement.library`, then `entitlement.entitlements.library`, and falls back to `adFree`
   only until this ships. Please do ship it so the fallback is not relied on.

4. `GET /api/billing/ad-free/products` should list the Library under what a plan unlocks
   (`removesAds`, `entitlements.library: true`) so the plan page can be driven from data later.

## 2. Existing pass holders (important)

Passes already sold have `ad_free` and `live_cbt_host` rows but **no `library` row**. Do not leave them locked out.
Do one of these:

- **Backfill (preferred):** a one-off script that, for every active `ad_free` row, creates a `library` row with the
  same `expiresAt`, `planKey` and `purchase` reference. Idempotent (unique `{ user, key }`).
- or derive: treat a live `ad_free` row as also granting `library` inside `studentEntitlements()` until the backfill
  has run. Remove the derivation after.

Admin grant and revoke (`/ad-free/entitlements/:userId/grant|revoke`) must accept the new key. A refund must revoke
the `library` row the purchase granted, and only that purchase's (a later stacked pass keeps its own).

## 3. Enforce it in the service, not the router

Same pattern as the Live CBT gate (`liveCbt.service.createExam` checks `live_cbt_host`): put the check inside the
library service functions that return content, so every caller goes through it.

```js
// library.service.js
const requireLibraryAccess = async (userId) => {
  if (!(await hasEntitlement(userId, 'library'))) {
    throw new AppError(402, 'PLAN_REQUIRED', 'Reading and downloading Library books needs a Student Pass.');
  }
};

export const getBookPages = async (userId, bookId, page) => {
  await requireLibraryAccess(userId);
  ...
};
export const getBookDownload = async (userId, bookId) => {
  await requireLibraryAccess(userId);
  ...
};
```

- Error body is the project's normal shape: `{ "error": { "code": "PLAN_REQUIRED", "message": "..." } }` with HTTP `402`.
- **Do not** apply it to list, details, bookmark or progress.
- **Do not** put file URLs in the book details or list responses. The download URL must only come from the gated
  endpoint, and it must be short-lived (signed, a few minutes), so a free student cannot reuse a link someone
  else shared after their pass ends.
- Page content must not be cached in a shared cache (CDN) without the entitlement check in front of it.
- Admins and super admins bypass the gate (they manage the books).

## 4. What the frontend does today

- Calls `GET /api/billing/entitlement` and shows the shelf to everyone.
- With no `library`/pass, it shows "Get a pass to read" and a locked download button, and a locked card at
  `/library/:id/read`.
- If it ever receives `402 PLAN_REQUIRED` from the pages or download endpoints (for example the pass ended while
  the reader was open), it will show the same locked card. The backend response is the source of truth.

## 5. Tests to add

1. Free student: list `200`, details `200`, pages `402 PLAN_REQUIRED`, download `402 PLAN_REQUIRED`.
2. Student with a live `library` entitlement: pages `200`, download `200` with a short-lived URL.
3. Expired pass (`expiresAt` in the past): pages `402` again with no job having to run.
4. Revoked entitlement and refunded purchase: `402`.
5. A stacked second pass keeps access after the first is refunded.
6. Backfilled holder (existing `ad_free` row): has `library` after the script/derivation.
7. Admin: pages `200` without a pass.
8. List and details responses contain no file URL.
9. A student cannot grant themselves `library` (the only student write is a checkout).

## 6. Docs to update

`docs/advertising.md` section 6 (the entitlement keys and the products table) and `docs/openapi.js`
(`/api/billing/entitlement` schema gains `library`; the library pages and download routes document `402`).
