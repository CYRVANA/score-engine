/**
 * Authoritative scoring logic. Server-side only. See ARCHITECTURE.md §7.
 *
 * The server fetches the canonical question data from Supabase, looks up the
 * chosen option for each answer, and sums the points. The client's idea of the
 * score is never trusted.
 */

export type AnswerSubmission = {
  question_id: string;
  option_index: number;
};

export type QuestionForScoring = {
  id: string;
  weight: number;
  options: Array<{ label: string; points: number }>;
};

export type ScoringResult = {
  total_score: number;
  per_answer: Array<{
    question_id: string;
    option_index: number;
    option_label: string;
    points: number;
  }>;
};

/**
 * Compute a quiz score from raw answer submissions.
 *
 * - Each answer's points come from the canonical question's option at the chosen index.
 * - If a question has a `weight`, the points are multiplied (v1: weight defaults to 1).
 * - Out-of-range option indexes contribute 0 points (defensive — client validation
 *   should prevent this, but never trust client input).
 *
 * Returns the total plus a per-answer breakdown so the caller can denormalize
 * `answers.points` at insert time (preserves historical scoring if questions
 * are later edited — see ARCHITECTURE.md §5 "Key design notes").
 */
export function scoreQuiz(
  answers: AnswerSubmission[],
  questions: QuestionForScoring[],
): ScoringResult {
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  let total = 0;
  const per_answer: ScoringResult["per_answer"] = [];

  for (const a of answers) {
    const q = questionsById.get(a.question_id);
    if (!q) continue; // unknown question id — skip silently

    const opt = q.options[a.option_index];
    if (!opt) {
      // out-of-range; record 0-point answer for traceability
      per_answer.push({
        question_id: a.question_id,
        option_index: a.option_index,
        option_label: "(invalid selection)",
        points: 0,
      });
      continue;
    }

    const points = opt.points * (q.weight ?? 1);
    total += points;
    per_answer.push({
      question_id: a.question_id,
      option_index: a.option_index,
      option_label: opt.label,
      points,
    });
  }

  return { total_score: total, per_answer };
}

/**
 * Given a score and the quiz's result tiers, pick the matching tier.
 * Returns null if no tier covers the score (shouldn't happen for well-configured quizzes).
 */
export function pickResultTier<T extends { min_score: number; max_score: number }>(
  score: number,
  tiers: T[],
): T | null {
  return tiers.find((t) => score >= t.min_score && score <= t.max_score) ?? null;
}
