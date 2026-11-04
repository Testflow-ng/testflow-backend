# Frontend update: what the redesigned student app needs from the backend

The student app is being redesigned (branch `redesign` in the frontend repo). Most screens use endpoints that already exist. This file lists what is **new or changed** so the backend can match. Newest items first.

## 0. Library is part of the Student Pass (backend enforced)

Free students browse the Library shelf; **reading and downloading need the pass**. The frontend shows the
locked state and the backend now enforces it: a `library` entitlement, `402 PLAN_REQUIRED` on the pages and
download endpoints only (browsing, bookmarks, progress and "Continue reading" stay free), and an idempotent
backfill for passes sold before the key existed (`npm run backfill:library`, run once at deploy).

```
GET    /api/library/books                      free   paged, searchable (q), filter=all|bookmarks, level, semester
GET    /api/library/books/:id                  free
GET    /api/library/reading                    free   every book started, newest first
POST   /api/library/books/:id/bookmark         free   toggle
PUT    /api/library/books/:id/progress         free   { page }, server computes percent
GET    /api/library/books/:id/pages?page=      PASS   one page at a time; 402 without the pass
GET    /api/library/books/:id/download         PASS   short-lived signed URL; 402 without the pass, 403 when no file
```

Full spec: [LIBRARY_GATE.md](./LIBRARY_GATE.md). Response shapes, paging contract and download rules:
[backend-library-api.md](../../../frontend/docs/backend-library-api.md). Seed a local shelf with
`npm run seed:library`.

## 1. Hall of Fame: overall leaderboard (new endpoint)

The sidebar has a new **Hall of Fame** page. It shows a board per subject and an **Overall** board.

- Per subject: uses the existing `GET /api/subjects/:id/leaderboard` (top 10). No change.
- **Overall: no endpoint exists.** The frontend currently fakes it by calling the per-subject board for every subject and adding up each student's best score. That is N requests, only covers each subject's top 10, and can rank people wrongly. Please add a real one.

### Requested endpoint

`GET /api/leaderboard` (authenticated)

Query:
- `limit` (default 10, max 50)
- `level` (optional: `100`..`500`) to scope to a level
- `period` (optional: `all` default, `month`, `week`)

Response `200`:

```json
{
  "leaderboard": [
    {
      "rank": 1,
      "username": "tunde_b",
      "fullName": "Tunde Bello",
      "points": 412,
      "subjectsCount": 5,
      "averageScore": 82.4,
      "examsCount": 14
    }
  ],
  "me": { "rank": 27, "points": 188, "subjectsCount": 3 }
}
```

Rules:
- `points` = the sum of each student's **best submitted score per subject** (same tie-breaks as the subject board: score, then questions, then time taken, then date). Say if you prefer another formula and the frontend will relabel it.
- Only count `status: 'submitted'` sessions.
- **Respect privacy:** exclude users with `showOnLeaderboard === false`, and users with no `username` (the board shows usernames). `me` is returned even when the user is below the limit, but only if they opted in.
- Cache for a few minutes; this is read-heavy.

### Small change to the subject board

Add `rank` to each row of `GET /api/subjects/:id/leaderboard`, and return `me` (the caller's own row and rank) when they are outside the top 10, so the page can say "You are #27".

## 2. Username is optional

The forced `/setup` page is gone. Signed-in users without a `username` see a **dismissible** popup and can set it later in Profile.

- `PATCH /api/auth/username` is unchanged and still used.
- Please make sure **no endpoint blocks a user who has no username** (for example exams or leaderboards must not return an error just because `username` is null).
- Usernames must be unique and `^[a-z0-9_]{3,20}$` (lower case). Return a clear `error.message` when taken; the frontend shows it.

## 3. Live CBT

The frontend now implements the full Live CBT flow against the existing `/api/live-cbt/*` routes (create, join, host approval, start, answer, submit, publish, result, dashboard, CSV). It polls `GET /:code` and `GET /:code/host` every 3 seconds. Things worth knowing:

- Invite links are built as `${CLIENT_URL}/live-cbt/:code`. The frontend redirects that to `/live/:code`, so no change is needed. If you would rather emit `/live/:code`, do that and the redirect stays harmless.
- The frontend decides "am I the host?" by calling `GET /:code/host` and treating a `403` as "no". Please keep returning `403` (not `404`) for non-hosts on an existing room.
- A `GET /:code` for a room the caller has not joined must still return the room with `membership: null` (it does today).
- Optional later: the frontend can switch from polling to the WebSocket (`/ws/live-cbt/:code`) or the SSE stream for instant updates.
- Published results read like the Hall of Fame on both sides. `GET /:code/result` now also carries a `leaderboard`: every submitted or timed-out paper, ranked, with `displayName`, `score`, `accuracy`, `timeTakenSeconds`, `correctCount`, `attemptStatus` and an `isYou` flag on the caller's own row. The board never carries an email.
- New host route: `GET /:code/participants/:userId/result` returns the same scored, corrected paper for one participant, so the host can open any name on the board. It is open once the sitting has ended (`409 EXAM_NOT_ENDED` before that), so a host can read papers before publishing; `404 PARTICIPANT_NOT_FOUND` for someone who never joined, `409 NO_SUBMISSION` for a paper that was never handed in, and `403 NOT_EXAM_HOST` for anyone but the host.
- The live room is a full-screen takeover now: `/live/:code` (and the `/live-cbt/:code` redirect) renders with no sidebar and no site header, like the CBT runtime, so the waiting room, the paper and the results all fill the screen. The live hub at `/live` keeps the normal shell.

## 4. Things the redesign still does not use

Nothing else in the backend needs to change for the redesigned screens so far (Settings, Notifications, Profile, Courses, Achievements, Progress and History). History and Progress now share one page and use `GET /api/exam-sessions` and `GET /api/exam-sessions/stats`.

Notification preferences are saved **on the device only** for now (`localStorage`). If you want them synced, add `GET/PATCH /api/auth/notification-preferences` with the keys: `exam_reminders`, `live_cbt`, `achievements`, `ai_suggestions`, `streak` (booleans).

## 5. The Everybody console and the tenant site API

The whole `/everybody/workspace/*` console now has a backend behind it, not just the organization record and billing. Everything is mounted under `/api/v1/everybody`, the organization is always a path segment, money is integer kobo, errors are `{ error: { code, message } }`, and lists are `{ items, page, limit, total }` unless a screen needs a different page field (questions also carry `pages`).

### What each console screen calls

- **Overview**: `GET /organizations`, `GET /organizations/:id`, `GET /organizations/:id/site`, `GET /organizations/:id/exams`, `GET /organizations/:id/students`, `GET /organizations/:id/earnings`.
- **Exams**: `GET/POST /organizations/:id/exams`, `GET/PATCH /organizations/:id/exams/:examId`, `POST .../publish`, `POST .../unpublish`.
- **Exam questions**: `GET/PUT /organizations/:id/exams/:examId/questions`. The PUT body is `{ questionIds }` and replaces the list in order.
- **Exam results**: `GET /organizations/:id/exams/:examId/results`, shape `{ items: [{ id, studentName, email, scorePercent, correct, total, timeMinutes, submittedAt }], summary: { attempts, average, highest, lowest } }`.
- **Question banks**: `GET/POST /organizations/:id/question-banks`, `PATCH/DELETE /organizations/:id/question-banks/:bankId`, `GET /organizations/:id/question-banks/:bankId/questions`. A bank row is `{ id, name, description, questionCount, createdAt }`. Deleting a bank also deletes the questions filed in it, and prunes those ids from any exam.
- **Questions**: `GET /organizations/:id/questions` (query `search`, `topic`, `difficulty`, `bankId`), `POST /organizations/:id/questions`, `PATCH/DELETE /organizations/:id/questions/:questionId`, `POST /organizations/:id/questions/bulk`, `POST /organizations/:id/questions/assets`.
- **Students**: `GET /organizations/:id/students` (query `search`, `role`), `GET /organizations/:id/students/:studentId` returns `{ student, attempts: [] }`. The sitting flow that writes attempts is the next phase, so the list is empty for now.
- **Announcements**: `GET/POST /organizations/:id/community/posts`, `PATCH/DELETE /organizations/:id/community/posts/:postId`. A post is `{ id, type, text, pinned, hidden, time, createdAt, updatedAt }`. `time` is a short date because the shared `PostCard` reads it.
- **Reported questions**: `GET /organizations/:id/question-flags` returns `{ items, counts: { open, resolved, dismissed } }`, `PATCH /organizations/:id/question-flags/:flagId` takes `{ status, resolution }`. Each row carries `reportCount`, `studentName`, `examTitle` and the populated `question`. The student-side "report this question" button is the next phase, so this queue starts empty.
- **Library**: `GET/POST /organizations/:id/library/books`, `PATCH/DELETE /organizations/:id/library/books/:bookId`.
- **Payments**: `GET /banks`, `POST /organizations/:id/payout/verify`, `PUT /organizations/:id/payout`, `GET /organizations/:id/earnings`, `GET /organizations/:id/payments`.
- **Domains**: `GET /domains/check-subdomain`, `GET/POST /organizations/:id/domains`, `POST .../domains/:domainId/verify`, `DELETE .../domains/:domainId`.
- **Site builder**: `GET /templates`, `GET/PATCH /organizations/:id/site`, `POST .../site/preview`, `POST .../site/publish`, `POST .../site/assets`.
- **Billing**: `GET /plans`, `GET /subscription?organizationId=`, `GET /payments?organizationId=`.

### Exam fields follow the console, not the old doc

The console's Rules tab sends `mode` (`anytime` or `live`), `startsAt`, `access` (`link`, `invited` or `code`), `accessCode` and `showCorrections` (`now`, `after_exam`, `score_only` or `hidden`). The earlier draft used `window`, `access: enrolled|assigned|code` and `resultsVisibility`, which would have been silently stripped or rejected. The backend now stores and returns the console's names, so `{ ...exam }` round-trips into the form unchanged.

A paid exam (`priceMinor > 0`) is refused at publish with `422 PAYOUT_REQUIRED` until a payout account is live. The same rule applies to a paid book.

### Tenant public API

The student-facing tenant site is `/api/v1/public/*` and resolves the organization from the address, never the body. The frontend states the address in `X-Tenant-Host` (or `?host=`), which is what makes local development work before DNS exists.

- `GET /site` returns `{ organization: { id, name, slug }, site: { template, brand, landing, portal, pages, footer }, meta }`.
- `GET /site/og.png` is a server-rendered 1200x630 PNG, and `GET /site/page` is the HTML with Open Graph tags. Neither needs a client canvas.
- `GET /site/pages/:page` is `404 PAGE_NOT_FOUND` when the owner switched that page off.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Sign-in requires an active student membership of this organization; a valid account with a membership elsewhere gets `403 NO_MEMBERSHIP`. A duplicate email gets `409 EMAIL_TAKEN`.
- `GET /exams` returns the published exams for a signed-in student, shape `{ items: [{ id, title, questionCount, durationMinutes, priceMinor }] }`.
- An unknown or suspended address is a flat `404 TENANT_NOT_FOUND`.

The OpenAPI document now lists all of these paths, so `/api/docs` is the reference for the exact bodies.
