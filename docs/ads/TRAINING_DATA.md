# Ad training-data foundation

**Status:** data collection + feature extraction + export only. No model is trained or deployed; the rules ranker (`deterministic-v1`, `src/utils/ads/ranker.js`) is unchanged and decides every ad.

## What is logged
One `AdDecision` per fresh `POST /api/ads/serve` decision (collection `addecisions`, `src/models/AdDecision.js`):

| Field | Meaning |
|---|---|
| `decisionId`, `serveId` | decision id; `serveId` (only when an ad was served) links outcomes |
| `ts` / `day` | **hour-rounded** time / UTC date |
| `ranker`, `policy {name:'rules', propensity:1, exploration:false}` | which algorithm decided; propensity/exploration placeholders so future randomized policies can be evaluated off-policy |
| `outcome` | `served` or `no_ad` |
| `noAdReason` | `frequency_capped` or `no_eligible_campaign` |
| `context` | bucketed CBT features (below) |
| `candidateCount`, `candidates[≤25]` | ranked eligible campaigns: `campaignKey`, `rank`, `relevance` (the rules score), `impressionsToday`, campaign `features`, `selected` |
| `selectedKey` | the served candidate |
| `label` | `impression`, `visibleMs`, `click`, `whatsappClick`, `skip` — filled in from accepted events through `serveId` |
| `expireAt` | `ts + trainingRetentionDays` |

Not logged on purpose: global "ads disabled" (no decision is made), and replays of an already-served session (not a new decision).

## Features (schema version 1, `src/utils/ads/features.js`)
**Session context** (all buckets/categoricals): `sessionType` (exam | post_utme), `subjectCodes` (≤4), `department` (lower-cased), `level`, `accuracyBand` (lt40 · 40_59 · 60_79 · 80_100), `answeredBand` (lt50 · 50_89 · 90_100), `timeUseBand` (share of allowed time used: lt50 · 50_79 · 80_100), `lengthBand` (short ≤10 · medium ≤30 · long), `strikesBand` (0 · 1 · 2plus), `streakBand` (0 · 1_2 · 3_6 · 7plus), `partOfDay` (WAT: morning/afternoon/evening/night), `dayType` (weekday/weekend, WAT), `adsSeenTodayBand` (0 · 1 · 2plus). Missing data becomes `unknown`.
**Campaign shape**: `destType`, `keywordCount`, `keywordMatch`, `titleLenBand`, `descWordsBand`, `durationBand`, `ageBand`, `remainingBand`. No title, description, URL, phone, image or advertiser.
Change any bucket → bump `FEATURE_SCHEMA_VERSION`.

## Privacy design
- No student id, name, email, username, matric, `studentKey`/`viewerHash`, session id or raw answers/question text. Exact scores and exact timestamps are never stored (bands, hour precision).
- Campaigns appear as `campaignKey`, a keyed HMAC pseudonym (`pseudonym.js`), not the database id; once a campaign is purged nothing links the key to content or advertiser.
- Stored **separately** from `Campaign`/`AdServe`/`AdEvent`: the 7-day campaign purge never touches it.
- Logging is best-effort: a failure is logged and never affects serving.
- Super-admin-only export, audited (`AD_TRAINING_EXPORT`).

## Retention
`AdSettings.trainingRetentionDays` (default **365**, allowed 30–1095) and `trainingLoggingEnabled` (default true; set false to stop collection). Enforced by the hourly `ads-retention` job (`sweepTrainingRecords`, honors a shortened setting immediately) plus a TTL index on `expireAt` as a safety net. Payment/audit retention is separate and unchanged.

## Using the data
- `GET /api/admin/ads/training/summary` (admin): counts, reasons, label totals, date range.
- `GET /api/admin/ads/training/export?from&to&includeNoAd&limit` (**super_admin**): streams JSONL.
- `node src/scripts/export-ad-training.js --out data/ad-training.jsonl [--from] [--to] [--served-only] [--limit]`.
One line = one decision: `{schema, decisionId, ts, ranker, policy, outcome, noAdReason, context, candidateCount, candidates[…], selectedKey, label}`. Only the **selected** ad has a `label`; unselected candidates have unknown outcomes.

## What the data can and cannot teach
It can estimate P(impression / click / WhatsApp / skip | context, ad shape) for ads the rules chose. With a deterministic ranker, ads that were never selected in a context have no outcomes, so a model trained only on this data mostly learns the rules' own behaviour (selection bias).

## Still required before training a model
1. **Privacy/legal sign-off:** update the privacy policy/notices for aggregated-behaviour processing (NDPA); confirm the 365-day default and that bucketed data is acceptable.
2. **Enough data:** let it collect; check `training/summary` for volume per context × campaign (CTR is low, so thousands of impressions are needed).
3. **Exploration:** add a small randomized-selection share (e.g. ε-greedy) and log its propensity (field already present), otherwise unbiased evaluation is impossible.
4. **Small-cell protection:** suppress or merge rare context combinations (k-anonymity) in exports used outside the team.
5. **Evaluation + serving plumbing:** offline metrics, a held-out rules baseline, shadow mode (score alongside the rules without acting), automatic fallback to `deterministic-v1`, model versioning/registry, and a latency budget in `serveAd`.
6. **Possible extras:** richer features once justified (subject difficulty, prior-session trend as bands), advertiser-side fairness/budget pacing, and a decision on whether per-student history (currently deliberately unlinkable) is wanted at all.
