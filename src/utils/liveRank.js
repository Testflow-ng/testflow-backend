/**
 * Deterministic scoring + ranking for Live CBT.
 *
 * Scoring rules (documented contract, applied identically to every participant):
 * - Each correct answer awards `marksPerQuestion` (default 1).
 * - Each incorrect answer deducts `negativeMarking` (default 0, max 5).
 * - Unanswered questions award 0 and never incur negative marking.
 * - Total score = correct*marks - incorrect*penalty, rounded to 2 decimals.
 * - Accuracy = (correct / totalQuestions) * 100, rounded to 2 decimals.
 *   (Uses total scorable questions, NOT attempted — unanswered counts as missed.)
 *
 * Ranking hierarchy (stable, total order — no shared positions):
 * 1. Higher total score first.
 * 2. Higher accuracy first.
 * 3. Lower completion time first (faster wins; never outranks a higher score).
 * 4. Lower server-assigned sequenceNumber first (deterministic final tie-breaker
 *    assigned at approval time, before the exam begins — never a runtime random).
 */

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const computeScore = ({ questions, marksPerQuestion = 1, negativeMarking = 0 }) => {
  const totalQuestions = questions.length;
  let correctCount = 0;
  let incorrectCount = 0;
  for (const question of questions) {
    if (question.selectedOption === null || question.selectedOption === undefined) continue;
    if (question.selectedOption === question.correctOption) correctCount += 1;
    else incorrectCount += 1;
  }
  const unansweredCount = totalQuestions - correctCount - incorrectCount;
  const raw = correctCount * marksPerQuestion - incorrectCount * negativeMarking;
  const score = round2(raw);
  const accuracy = totalQuestions ? round2((correctCount / totalQuestions) * 100) : 0;
  const totalPossible = round2(totalQuestions * marksPerQuestion);
  return { score, correctCount, incorrectCount, unansweredCount, accuracy, totalQuestions, totalPossible };
};

/**
 * Stable deterministic ranking. Input entries need:
 * { key, score, accuracy, timeTakenSeconds, sequenceNumber }.
 * Missing/infinite times (never submitted) sort last. Returns a NEW array with
 * unique ordinal `rank` 1..N. Never assigns shared positions.
 */
export const rankParticipants = (entries) => {
  const decorated = entries.map((entry, index) => ({ ...entry, __index: index }));
  decorated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    const aTime = Number.isFinite(a.timeTakenSeconds) ? a.timeTakenSeconds : Number.MAX_SAFE_INTEGER;
    const bTime = Number.isFinite(b.timeTakenSeconds) ? b.timeTakenSeconds : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    const aSeq = Number.isFinite(a.sequenceNumber) ? a.sequenceNumber : Number.MAX_SAFE_INTEGER;
    const bSeq = Number.isFinite(b.sequenceNumber) ? b.sequenceNumber : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) return aSeq - bSeq;
    // Absolute final fallback: original input order (stable sort guarantee).
    return a.__index - b.__index;
  });
  return decorated.map((item, position) => {
    const { __index, ...entry } = item;
    void __index;
    return { ...entry, rank: position + 1 };
  });
};
