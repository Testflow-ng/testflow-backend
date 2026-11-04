/**
 * Deterministic ad ranking ("deterministic-v1").
 *
 * The serving service depends ONLY on this interface:
 *   rank(candidates, context) -> candidate[]   (best first)
 * A future recommendation model can replace `rank` (same input/output) without
 * changing the HTTP contract; `RANKER_VERSION` is echoed in serve responses.
 *
 * Order: (1) keyword relevance to the student's context, (2) fairest rotation
 * — fewest impressions today, (3) campaigns ending soonest, (4) _id (stable).
 */
export const RANKER_VERSION = 'deterministic-v1';

const tokens = (values) =>
  new Set(
    values
      .filter(Boolean)
      .flatMap((v) => String(v).toLowerCase().split(/[^a-z0-9]+/))
      .filter((t) => t.length >= 2),
  );

/** Count keyword matches between a campaign and the student's context. */
export const relevance = (campaign, context) => {
  const ctx = tokens([...(context.subjects ?? []), ...(context.subjectCodes ?? []), context.department]);
  let score = 0;
  for (const kw of campaign.keywords ?? []) {
    const parts = [...tokens([kw])];
    if (parts.length && parts.every((p) => ctx.has(p))) score += 2;
    else if (parts.some((p) => ctx.has(p))) score += 1;
  }
  return score;
};

export const rank = (candidates, context, { impressionsToday = () => 0 } = {}) =>
  candidates
    .map((c) => ({ c, rel: relevance(c, context), today: impressionsToday(c) }))
    .sort(
      (a, b) =>
        b.rel - a.rel ||
        a.today - b.today ||
        new Date(a.c.endsAt) - new Date(b.c.endsAt) ||
        String(a.c._id).localeCompare(String(b.c._id)),
    )
    .map(({ c, rel }) => ({ campaign: c, relevance: rel }));
