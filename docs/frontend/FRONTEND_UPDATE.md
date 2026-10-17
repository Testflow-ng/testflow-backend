# Frontend update: what the redesigned student app needs from the backend

The student app is being redesigned (branch `redesign` in the frontend repo). Most screens use endpoints that already exist. This file lists what is **new or changed** so the backend can match. Newest items first.

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

## 4. Things the redesign still does not use

Nothing else in the backend needs to change for the redesigned screens so far (Settings, Notifications, Profile, Courses, Achievements, Progress and History). History and Progress now share one page and use `GET /api/exam-sessions` and `GET /api/exam-sessions/stats`.

Notification preferences are saved **on the device only** for now (`localStorage`). If you want them synced, add `GET/PATCH /api/auth/notification-preferences` with the keys: `exam_reminders`, `live_cbt`, `achievements`, `ai_suggestions`, `streak` (booleans).
