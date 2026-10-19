/**
 * The band a score falls in, and the mood Flo wears on a shared card.
 *
 * Both come from the same thresholds the client uses in
 * `src/components/brand/mascotMood.js`, so the card a crawler renders and the screen the student
 * is looking at agree about how the paper went. The band has three labels; the mascot has four
 * moods, which is why a strong pass and a pass share "On track" but not an expression.
 */
const STRONG = 85;
const PASS = 70;
const BORDERLINE = 50;

export const bandForScore = (score) => {
  const value = Number(score);
  const safe = Number.isFinite(value) ? value : 0;

  if (safe >= PASS) {
    return { label: 'On track', mood: safe >= STRONG ? 'excited' : 'thumbsUp' };
  }
  if (safe >= BORDERLINE) {
    return { label: 'Borderline', mood: 'encouraging' };
  }
  return { label: 'Needs work', mood: 'sad' };
};
