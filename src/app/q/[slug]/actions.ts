"use server";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  scoreQuiz,
  pickResultTier,
  type AnswerSubmission,
  type QuestionForScoring,
} from "@/lib/scoring";

/**
 * Server Actions for the public quiz flow. See ARCHITECTURE.md §6 — these
 * use the service-role client to bypass RLS so anonymous takers can write
 * sessions and answers without granting anon table-level access.
 *
 * Phase 1.2: startSession + submitQuiz. Phase 1.3 will add captureLead.
 */

export type SubmitResult =
  | {
      ok: true;
      score: number;
      result_tier: { id: string; title: string } | null;
    }
  | { ok: false; error: string };

/**
 * Create a new session row when the quiz page loads.
 * Captures metadata (UTM params, referrer, user agent) for funnel attribution.
 * Returns the session UUID for the client to use when submitting answers.
 */
export async function startSession(
  quizId: string,
  metadata: Record<string, unknown> = {},
): Promise<{ session_id: string } | { error: string }> {
  const supabase = createServiceRoleClient();

  // Best-effort enrichment of metadata from request headers.
  const headerList = await headers();
  const enrichedMetadata = {
    ...metadata,
    user_agent: headerList.get("user-agent") ?? null,
    referer: headerList.get("referer") ?? null,
  };

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      quiz_id: quizId,
      metadata: enrichedMetadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to start session" };
  }

  return { session_id: data.id };
}

/**
 * Finalize a quiz: re-fetch authoritative questions, recompute the score,
 * persist answers, update the session with score + tier, return results.
 *
 * Notice: we DO NOT trust any points value sent by the client. We use
 * answer.option_index to look up the canonical option server-side.
 */
export async function submitQuiz(
  sessionId: string,
  quizId: string,
  answers: AnswerSubmission[],
): Promise<SubmitResult> {
  const supabase = createServiceRoleClient();

  // 1. Re-fetch the canonical questions for this quiz.
  const { data: questionsRaw, error: qErr } = await supabase
    .from("questions")
    .select("id, weight, options")
    .eq("quiz_id", quizId);

  if (qErr || !questionsRaw) {
    return { ok: false, error: qErr?.message ?? "Could not load questions" };
  }

  const questions: QuestionForScoring[] = questionsRaw.map((q) => ({
    id: q.id,
    weight: q.weight ?? 1,
    options: (q.options as QuestionForScoring["options"]) ?? [],
  }));

  // 2. Score authoritatively.
  const { total_score, per_answer } = scoreQuiz(answers, questions);

  // 3. Fetch tiers and pick the matching one.
  const { data: tiers, error: tErr } = await supabase
    .from("result_tiers")
    .select("id, title, min_score, max_score")
    .eq("quiz_id", quizId);

  if (tErr) {
    return { ok: false, error: tErr.message };
  }

  const tier = tiers ? pickResultTier(total_score, tiers) : null;

  // 4. Persist each answer with denormalized points (see ARCHITECTURE.md §5).
  if (per_answer.length > 0) {
    const answerRows = per_answer.map((a) => ({
      session_id: sessionId,
      question_id: a.question_id,
      value: { option_index: a.option_index, option_label: a.option_label },
      points: a.points,
    }));

    const { error: aErr } = await supabase.from("answers").insert(answerRows);
    if (aErr) {
      return { ok: false, error: aErr.message };
    }
  }

  // 5. Mark the session complete with score + tier.
  const { error: sErr } = await supabase
    .from("sessions")
    .update({
      score: total_score,
      result_tier_id: tier?.id ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (sErr) {
    return { ok: false, error: sErr.message };
  }

  return {
    ok: true,
    score: total_score,
    result_tier: tier ? { id: tier.id, title: tier.title } : null,
  };
}
