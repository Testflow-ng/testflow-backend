/**
 * Privacy-conscious feature extraction for the (future) ad model.
 *
 * Everything returned here is a coarse BUCKET or a small categorical value:
 * no student id/email/name, no session id, no raw answers or question content,
 * no exact scores or timestamps. Pure functions — unit-testable without a DB.
 *
 * Bump FEATURE_SCHEMA_VERSION whenever a bucket definition or field changes so
 * training code can tell records apart.
 */
export const FEATURE_SCHEMA_VERSION = 1;
export const MAX_CANDIDATES_LOGGED = 25;

const pick = (value, bands) => {
  for (const [limit, label] of bands) if (value < limit) return label;
  return bands.at(-1)[1];
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const accuracyBand = (pct) => {
  const v = num(pct);
  if (v === null) return 'unknown';
  return pick(v, [[40, 'lt40'], [60, '40_59'], [80, '60_79'], [Infinity, '80_100']]);
};
export const timeUseBand = (usedSeconds, allowedSeconds) => {
  const u = num(usedSeconds); const a = num(allowedSeconds);
  if (u === null || !a) return 'unknown';
  return pick((u / a) * 100, [[50, 'lt50'], [80, '50_79'], [Infinity, '80_100']]);
};
export const answeredBand = (answered, total) => {
  const a = num(answered); const t = num(total);
  if (a === null || !t) return 'unknown';
  return pick((a / t) * 100, [[50, 'lt50'], [90, '50_89'], [Infinity, '90_100']]);
};
export const lengthBand = (totalQuestions) => {
  const t = num(totalQuestions);
  if (t === null) return 'unknown';
  return pick(t, [[11, 'short'], [31, 'medium'], [Infinity, 'long']]);
};
export const strikesBand = (s) => (num(s) === null ? 'unknown' : s <= 0 ? '0' : s === 1 ? '1' : '2plus');
export const streakBand = (s) => (num(s) === null ? 'unknown' : pick(s, [[1, '0'], [3, '1_2'], [7, '3_6'], [Infinity, '7plus']]));
export const seenTodayBand = (n) => (n <= 0 ? '0' : n === 1 ? '1' : '2plus');

/** Nigerian local time (WAT = UTC+1, no DST). */
const wat = (date) => new Date(date.getTime() + 60 * 60 * 1000);
export const partOfDay = (date) => {
  const h = wat(date).getUTCHours();
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
};
export const dayType = (date) => ([0, 6].includes(wat(date).getUTCDay()) ? 'weekend' : 'weekday');

const norm = (s) => (typeof s === 'string' && s.trim() ? s.trim().toLowerCase().slice(0, 60) : null);

/**
 * @param {object} s plain summary built by the serving service from the
 *   completed session + user: { sessionType, subjectCodes[], department, level,
 *   correct, totalQuestions, answered, timeTakenSeconds, durationMinutes, strikes, streakCount }
 */
export const extractSessionFeatures = (s, { now = new Date(), adsSeenToday = 0 } = {}) => ({
  sessionType: s.sessionType,
  subjectCodes: [...new Set((s.subjectCodes ?? []).filter(Boolean).map((c) => String(c).toUpperCase().slice(0, 12)))].sort().slice(0, 4),
  department: norm(s.department),
  level: s.level ?? null,
  accuracyBand: accuracyBand(s.totalQuestions ? (s.correct / s.totalQuestions) * 100 : null),
  answeredBand: answeredBand(s.answered, s.totalQuestions),
  timeUseBand: timeUseBand(s.timeTakenSeconds, (s.durationMinutes ?? 0) * 60),
  lengthBand: lengthBand(s.totalQuestions),
  strikesBand: strikesBand(s.strikes),
  streakBand: streakBand(s.streakCount),
  partOfDay: partOfDay(now),
  dayType: dayType(now),
  adsSeenTodayBand: seenTodayBand(adsSeenToday),
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** Campaign CONTENT (title/description/url) is never copied — only coarse shape. */
export const extractCampaignFeatures = (c, { now = new Date(), relevance = 0 } = {}) => ({
  destType: c.destination?.type ?? 'unknown',
  keywordCount: (c.keywords ?? []).length,
  keywordMatch: relevance > 0,
  titleLenBand: pick((c.title ?? '').length, [[31, 'short'], [56, 'medium'], [Infinity, 'long']]),
  descWordsBand: pick((c.description ?? '').trim().split(/\s+/).filter(Boolean).length, [[31, 'le30'], [101, '31_100'], [Infinity, 'gt100']]),
  durationBand: pick(c.durationDays ?? 0, [[4, '1_3'], [8, '4_7'], [15, '8_14'], [Infinity, '15plus']]),
  ageBand: c.startsAt ? pick((now - new Date(c.startsAt)) / DAY_MS, [[2, '0_1'], [4, '2_3'], [8, '4_7'], [Infinity, '8plus']]) : 'unknown',
  remainingBand: c.endsAt ? pick((new Date(c.endsAt) - now) / DAY_MS, [[1, 'lt1'], [3, '1_2'], [8, '3_7'], [Infinity, 'gt7']]) : 'unknown',
});

const hourOf = (d) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

/** Build the AdDecision document body (pure). `keyOf` maps a campaign id to its pseudonymous key. */
export const buildDecisionRecord = ({
  decisionId, serveId, now = new Date(), rankerVersion, outcome, noAdReason, session, ranked = [], impressionsToday = () => 0,
  keyOf, retentionDays,
}) => {
  const candidates = ranked.slice(0, MAX_CANDIDATES_LOGGED).map((r, i) => ({
    campaignKey: keyOf(r.campaign._id),
    rank: i + 1,
    relevance: r.relevance,
    impressionsToday: Math.min(impressionsToday(r.campaign) ?? 0, 100000),
    features: extractCampaignFeatures(r.campaign, { now, relevance: r.relevance }),
    selected: outcome === 'served' && i === 0,
  }));
  return {
    schemaVersion: FEATURE_SCHEMA_VERSION,
    decisionId,
    serveId: outcome === 'served' ? serveId : undefined,
    ts: hourOf(now), // hour precision on purpose: no exact timestamps
    day: now.toISOString().slice(0, 10),
    ranker: rankerVersion,
    policy: { name: 'rules', propensity: 1, exploration: false },
    outcome,
    noAdReason: outcome === 'no_ad' ? noAdReason : undefined,
    context: session,
    candidateCount: ranked.length,
    candidates,
    selectedKey: candidates.find((c) => c.selected)?.campaignKey,
    expireAt: new Date(now.getTime() + retentionDays * DAY_MS),
  };
};

/** Flat JSONL line for model training. `label` is only defined for the selected ad. */
export const toExportRecord = (d) => ({
  schema: d.schemaVersion,
  decisionId: d.decisionId,
  ts: d.ts instanceof Date ? d.ts.toISOString() : d.ts,
  ranker: d.ranker,
  policy: d.policy,
  outcome: d.outcome,
  noAdReason: d.noAdReason ?? null,
  context: d.context,
  candidateCount: d.candidateCount,
  candidates: d.candidates.map(({ campaignKey, rank, relevance, impressionsToday, features, selected }) => ({
    campaignKey, rank, relevance, impressionsToday, features, selected,
  })),
  selectedKey: d.selectedKey ?? null,
  label: d.outcome === 'served'
    ? {
      impression: !!d.label?.impression,
      visibleMs: d.label?.visibleMs ?? null,
      click: !!d.label?.click,
      whatsappClick: !!d.label?.whatsappClick,
      skip: !!d.label?.skip,
    }
    : null,
});
