# Testflow for Everyone: exams, results, flags and corrections (backend spec to review)

Status: **proposal for review.** The frontend (organiser workspace and tenant student site) is built against this and runs on sample data today.
Conventions: JSON, errors `{ error: { code, message, fields? } }`, lists `{ items, page, limit, total }`, money in integer kobo. `:orgId` routes need an
`OrgMembership` with role owner or admin. Tenant routes (`/api/v1/public/...`) resolve the organisation from `X-Tenant-Host` and need a student session of that organisation.

## 1. Exam

| Field | Type | Notes |
|---|---|---|
| `title` | string 2-120 | |
| `instructions` | string, optional | shown before starting |
| `mode` | `anytime` \| `live` | live = everyone starts at `startsAt` |
| `startsAt` | ISO datetime | required for `live`, ignored otherwise |
| `durationMinutes` | int 1-360 | server clock is the only clock |
| `priceMinor` | int >= 0 | 0 = free. Only thing students pay for |
| `access` | `link` \| `invited` \| `code` | `accessCode` required for `code` (stored hashed) |
| `showCorrections` | `now` \| `after_exam` \| `score_only` \| `hidden` | see section 4 |
| `shuffleQuestions`, `shuffleOptions` | bool | |
| `negativeMarking` | number >= 0 | marks lost per wrong answer |
| `attemptsAllowed` | int >= 1 | |
| `status` | `draft` \| `published` | |
| `questionCount` | derived | |

Endpoints: `GET|POST /organizations/:orgId/exams`, `GET|PATCH|DELETE .../exams/:examId`, `POST .../exams/:examId/publish|unpublish`.
- Publish requires at least one question (`422 NO_QUESTIONS`) and, when `priceMinor > 0`, an active payout account (`422 PAYOUT_REQUIRED`).
- `live` needs `startsAt` in the future when publishing (`422 START_IN_PAST`).
- A published exam with attempts: `questions`, `durationMinutes`, `negativeMarking` become read-only (`409 EXAM_LOCKED`); title, instructions, access, `showCorrections` stay editable.
- Delete: draft with no attempts is deleted; otherwise it is archived (soft) and its results are kept.

## 2. Exam questions

- `GET .../exams/:examId/questions` returns the questions in order (organiser view includes `correctIndex`).
- `PUT .../exams/:examId/questions { questionIds: [] }` replaces the list and the order (max 500).
- `POST .../questions?examId=` and `POST .../questions/bulk?examId=` create and attach in one step.
- A question is `{ id, stem, stemImageUrl?, options: [{ text, imageUrl? }] (2-6), correctIndex, topic?, difficulty, explanation?, explanationImageUrl? }`. Frontend currently sends
  `options` as strings plus `optionImages: []`; accept both and return the object form.

### Editing and deleting a question (the rules)
- **Edit** (`PATCH .../questions/:questionId`): allowed any time. If the question is in a published exam that already has attempts, the change applies to **new** attempts only;
  each attempt stores a **snapshot** of the questions it was given, so past scores and corrections never change. A wrong answer key fixed later does not silently rescore (see 5).
- **Remove from an exam** is the `PUT .../questions` call above. Locked when the exam has attempts (`409 EXAM_LOCKED`).
- **Delete** (`DELETE .../questions/:questionId`): removes it from the bank and from draft exams. If it is in a published exam with attempts it is **soft-deleted** (hidden from the bank and
  from new attempts, kept in snapshots) and the response says `{ softDeleted: true }`. Audit log entry either way.
- Images attached to a deleted question are released after the retention window, not immediately.

### Question banks (folders of questions)

An organisation keeps questions in **banks** (Mathematics, JAMB English...). A bank is only a folder: exams pick questions *from* a bank.

- Model `QuestionBank { id, organization, name (2-80), description?, createdAt }`; a question has `bankId` (required; questions created inside an exam without a bank go to an auto-created "Unsorted" bank).
- `GET|POST /organizations/:orgId/question-banks` (list returns `questionCount`), `PATCH|DELETE .../question-banks/:bankId`.
- `GET .../question-banks/:bankId/questions?page&limit&search` returns `{ items, total, page, pages }`.
- `POST .../questions` and `POST .../questions/bulk` accept `bankId` (body or `?bankId=`) so new questions land in that bank; they may also accept `examId` to attach to an exam at the same time.
- **Using a bank in an exam** is just `PUT .../exams/:examId/questions { questionIds }`: the UI offers "add the whole bank" or "tick some". The exam then **references** those questions; once an exam has attempts, attempts snapshot the questions (see rules above), so later bank edits never change past results.
- Deleting a bank deletes its questions **only if none is in a published exam with attempts**; otherwise those questions are soft-deleted (hidden from the bank, kept for attempt snapshots). Exams that merely reference them keep working until unpublished; the response lists `{ deleted, softDeleted }`.
- Moving a question between banks: `PATCH .../questions/:qid { bankId }`.
- Limits to decide: banks per organisation (proposed 100) and questions per bank (proposed 5,000), plus storage for question images.

## 3. Results and records (organiser)

- `GET .../exams/:examId/results?page&limit` returns `{ items: [{ id, studentId, studentName, email, scorePercent, correct, total, timeMinutes, submittedAt, status }], summary: { attempts, average, highest, lowest } }`. Always real scores, regardless of `showCorrections`.
- `GET .../exams/:examId/results.csv` (same data, streamed).
- `GET .../students` adds `attempts` and `average`; `GET .../students/:studentId` returns `{ student, attempts: [{ id, examId, examTitle, scorePercent, correct, total, submittedAt }] }`.
- `GET .../attempts/:attemptId` returns one attempt with the student's answers and the correct answers (organiser only).

## 4. What a student sees after finishing (enforced by the backend)

Setting `showCorrections` decides what the tenant endpoints return. The UI is a courtesy; the API must not leak more than allowed.

| Setting | Score | Corrections | Student message |
|---|---|---|---|
| `now` | yes | yes, immediately | |
| `after_exam` | yes | `null` until the exam closes (live: `startsAt + duration + grace`; anytime: when unpublished or after its window), then yes | "Corrections open after the exam closes" |
| `score_only` | yes | never (`corrections: null`) | |
| `hidden` | **no** | **no** | "Submitted. Your result has been recorded." |

- `GET /api/v1/public/results` and `GET /api/v1/public/results/:attemptId`: for `hidden`, return `{ id, examTitle, submittedAt, hidden: true }` with **no** `scorePercent`, `correct`, `total` or `corrections`.
  The submit response for a `hidden` exam must not contain the score either.
- Changing `showCorrections` later changes what students see for past attempts too (it is read at request time).
- The organiser can still publish scores manually later by switching the exam to another setting.

## 5. Flagging a question

### Student
`POST /api/v1/public/questions/:questionId/flag` `{ reason: 'wrong_answer'|'unclear'|'typo'|'other', note?: string (max 500), attemptId? }`
- Only a student who has **seen** the question (has an attempt that includes it) may flag it, else `403 NOT_A_PARTICIPANT`.
- One open flag per student per question; a repeat updates the note and returns `200` (idempotent). Rate limit per student.
- Returns `{ ok: true }`. The student never sees other students' reports.

### Organiser
- `GET /organizations/:orgId/question-flags?status=open|resolved|dismissed` returns `{ items: [{ id, status, reason, note, createdAt, reportCount, examTitle?, studentName, resolution?, question: { id, stem, options, correctIndex } | null }], counts: { open, resolved, dismissed } }`. `question` is `null` when it was deleted. `reportCount` = reports for that question.
- `PATCH /organizations/:orgId/question-flags/:flagId` `{ status: 'resolved'|'dismissed'|'open', resolution?: string }`. `resolved` and `dismissed` require a `resolution` note (3+ chars). Closing one flag closes all open flags for the same question when asked: `?all=true`.
- The organiser then edits or deletes the question with the normal question endpoints (section 2). A fix does **not** rescore past attempts. If a wrong key must be rescored, offer a deliberate `POST .../exams/:examId/rescore { questionId }` that is audited and shows the new average (optional, later).
- Notify the owner by email or in-app when a question reaches 3 open reports (optional).

## 6. Live CBT mode (organisation exams, Studio plan only)

**Plan gate:** only organisations on **Studio** may create, publish or start a `mode: 'live'` exam; others get `402 PLAN_REQUIRED` (`details.feature = 'live_cbt'`). Downgrade rules are in `EVERYONE_REQUIREMENTS.md` section 12.

- `mode: 'live'`: the exam page shows a waiting room until `startsAt`; everyone gets the same server `startedAt`/`endsAt`; late joiners (until `startsAt + 10 min`) get the remaining time only. Reuse the existing live-CBT room, timer and submit machinery rather than building a second one.
- The organiser sees live counts (joined, started, submitted) on the exam page via polling `GET .../exams/:examId/live` (SSE later).
- A paid live exam collects payment **before** the student can enter the waiting room.

## 7. Payment (the only student payment)

- `POST /api/v1/public/exams/:examId/checkout` `{ idempotencyKey }` returns `{ authorizationUrl, reference }` with the organisation's Paystack `subaccount` and Testflow's `percentage_charge` set server-side. `GET .../checkout/verify?reference=` re-verifies. Access to the exam is granted only after verification.
- Records for the organiser: `GET .../payments` (gross, Testflow share, organiser share), as in `EVERYONE_REQUIREMENTS.md` section 4.
- No other student purchase exists (no pass, no ad removal, no paid books for now).

## 8. Announcements

`community/posts` with `type: 'announcement'`: `GET|POST .../community/posts`, `PATCH|DELETE .../community/posts/:postId` (`pinned`, `hidden`).
Students: `GET /api/v1/public/announcements` returns visible posts, pinned first.

## 9. Ads follow the plan

`GET /api/v1/public/site` returns `site.ads: { enabled, publisherId, slots: { portal_home, before_corrections } }`. `enabled` is false on Studio, on read-only/expired workspaces, and never true for exam or sitting pages.

## 10. Permissions

| Action | Owner | Admin | Student |
|---|---|---|---|
| Exams, questions, rules, publish | yes | yes | no |
| Results, student records | yes | yes | own only |
| Question flags: list, resolve | yes | yes | no |
| Flag a question | no | no | yes (if they saw it) |
| Delete question / exam | yes | yes (not owner-only data) | no |
| Payout, plan | yes | no | no |
| Live CBT exams | yes (Studio only) | yes (Studio only) | join only |

## 11. Tests to add
1. `hidden` exam: results list and detail contain no score or corrections; organiser results contain scores.
2. `after_exam`: corrections `null` before close, present after; `score_only`: never.
3. Flag: non-participant `403`; duplicate is idempotent; resolved/dismissed need a note; deleted question gives `question: null`.
4. Edit a question in a published exam with attempts: old attempts unchanged, new attempts use the new text; delete soft-deletes.
5. Publish: no questions `422`, paid without payout `422`, live in the past `422`; locked fields `409`.
6. Cross-tenant: org A cannot read, flag or edit org B's exams, questions, flags or results (404).
7. Paid exam: no access before verified payment; split recorded; refund reverses it.
8. Live CBT: Pro organisation gets `402 PLAN_REQUIRED` on create, publish and start; Studio succeeds; downgrade unpublishes scheduled live exams but lets running sittings finish.

## 12. Open questions for review
- Should closing a flag with `resolved` offer automatic rescoring, or stay manual?
- Grace period for `after_exam` on live exams (proposed 10 minutes)?
- Should students be able to see *that* they flagged a question (a small "Reported" tag)? Proposed: yes, for their own flags.
- Retention for soft-deleted questions and archived exams (proposed 12 months).

> Plan gates for paid exams and the 3-exam Free limit: see EVERYONE_REQUIREMENTS.md section 13.

## Student record page (organiser)

`GET /api/v1/everybody/organizations/:orgId/students/:studentId` powers the full page `/workspace/students/:id` (not a pop-up).

```json
{
  "student": { "id": "s1", "fullName": "Tunde Bello", "email": "t@mail.com", "status": "active", "joinedAt": "2026-10-01T09:00:00Z" },
  "attempts": [
    { "id": "a1", "examId": "e1", "examTitle": "Mathematics mock", "scorePercent": 78, "correct": 6, "total": 8, "timeMinutes": 33, "submittedAt": "2026-10-14T10:00:00Z" }
  ]
}
```

- Only attempts on this organisation's exams; newest or oldest order does not matter (the page sorts). `timeMinutes` is new, please include it.
- 404 `NOT_FOUND` if the student does not belong to the organisation. Organiser (owner or admin) only.
- The page draws "score over time" and "average by exam" from `attempts`; no separate chart endpoint needed.
- Students list rows (`GET .../students`) keep `attempts` (count) and `average` for the table.
