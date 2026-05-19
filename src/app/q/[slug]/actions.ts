"use server";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  scoreQuiz,
  pickResultTier,
  type AnswerSubmission,
  type QuestionForScoring,
} from "@/lib/scoring";
import { validateEmail, emailValidationMessage } from "@/lib/email-validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isDestinationsEnabled } from "@/lib/feature-flags";

/**
 * Server Actions for the public quiz flow. See ARCHITECTURE.md §6, §8.
 * All use the service-role client to bypass RLS so anonymous takers can
 * write sessions/answers/leads without granting anon write access.
 */

const CYRVANA_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

// =========================================================================
// startSession — unchanged from Phase 1.2
// =========================================================================
export async function startSession(
  quizId: string,
  metadata: Record<string, unknown> = {},
): Promise<{ session_id: string } | { error: string }> {
  const supabase = createServiceRoleClient();

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

// =========================================================================
// submitQuiz — unchanged from Phase 1.2
// =========================================================================
export type SubmitResult =
  | {
      ok: true;
      score: number;
      result_tier: { id: string; title: string } | null;
    }
  | { ok: false; error: string };

export async function submitQuiz(
  sessionId: string,
  quizId: string,
  answers: AnswerSubmission[],
): Promise<SubmitResult> {
  const supabase = createServiceRoleClient();

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

  const { total_score, per_answer } = scoreQuiz(answers, questions);

  const { data: tiers, error: tErr } = await supabase
    .from("result_tiers")
    .select("id, title, min_score, max_score")
    .eq("quiz_id", quizId);

  if (tErr) {
    return { ok: false, error: tErr.message };
  }

  const tier = tiers ? pickResultTier(total_score, tiers) : null;

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

// =========================================================================
// captureLead — NEW for Phase 1.4
// =========================================================================
export type LeadCaptureInput = {
  session_id: string;
  quiz_id: string;
  email: string;
  name: string;
  consent: boolean;
  honeypot: string;
};

export type CaptureResult =
  | { ok: true; lead_id: string }
  | {
      ok: false;
      reason: "rate_limited" | "invalid_email" | "missing_consent" | "bot" | "server_error";
      message: string;
    };

/**
 * Validate and persist a lead from the email gate.
 *
 * Defense layers (in order):
 *  1. Honeypot: if filled, log the attempt and silently "succeed" (bots
 *     never learn they were detected). No lead row created.
 *  2. Rate limit: max 5 lead captures per IP per 10 minutes.
 *  3. Consent: must be explicitly true.
 *  4. Email: format + disposable-domain blocklist.
 *  5. Session sanity check: the session must exist, belong to the claimed
 *     quiz, and have completed_at set (so we know scoring ran).
 *
 * Per §14.5 decision: INSERT a new leads row per attempt, even on retakes.
 * Multiple attempts with the same email create multiple leads, linked by
 * shared email — gives us retake/progression data.
 */
export async function captureLead(input: LeadCaptureInput): Promise<CaptureResult> {
  const supabase = createServiceRoleClient();
  const headerList = await headers();
  const clientIp = getClientIp(headerList);

  // --- 1. Honeypot ---
  if (input.honeypot && input.honeypot.length > 0) {
    // Log the attempt for visibility into bot activity, then pretend success.
    console.warn("[captureLead] honeypot triggered", {
      ip: clientIp,
      session_id: input.session_id,
      honeypot_value: input.honeypot.slice(0, 50), // truncate for log hygiene
    });
    // Return a fake success so the bot's behavior is indistinguishable from
    // a successful submission. We do NOT actually save a lead.
    return { ok: true, lead_id: "00000000-0000-0000-0000-000000000000" };
  }

  // --- 2. Rate limit ---
  const allowed = await checkRateLimit({
    scope: "lead_capture",
    key: clientIp,
    limit: 5,
    windowSeconds: 600, // 10 minutes
  });
  if (!allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many submissions from this network. Please wait a few minutes and try again.",
    };
  }

  // --- 3. Consent ---
  if (!input.consent) {
    return {
      ok: false,
      reason: "missing_consent",
      message: "Please agree to receive your results to continue.",
    };
  }

  // --- 4. Email validation ---
  const emailCheck = validateEmail(input.email);
  if (!emailCheck.ok) {
    return {
      ok: false,
      reason: "invalid_email",
      message: emailValidationMessage(emailCheck.reason),
    };
  }

  // --- 5. Session sanity check ---
  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select(
      `
      id, quiz_id, completed_at, score,
      quizzes:quiz_id ( title, slug ),
      result_tiers:result_tier_id ( title )
    `,
    )
    .eq("id", input.session_id)
    .single();

  if (sErr || !session) {
    return {
      ok: false,
      reason: "server_error",
      message: "We couldn't find your session. Please refresh and try the quiz again.",
    };
  }

  if (session.quiz_id !== input.quiz_id) {
    // Session/quiz mismatch — possible tampering, log it.
    console.warn("[captureLead] session/quiz mismatch", {
      session_id: input.session_id,
      claimed_quiz: input.quiz_id,
      actual_quiz: session.quiz_id,
    });
    return {
      ok: false,
      reason: "server_error",
      message: "Session mismatch. Please refresh and try the quiz again.",
    };
  }

  if (!session.completed_at) {
    return {
      ok: false,
      reason: "server_error",
      message: "Please complete the quiz before submitting your details.",
    };
  }

  // --- 6. Insert lead ---
  const now = new Date().toISOString();
  const { data: lead, error: lErr } = await supabase
    .from("leads")
    .insert({
      workspace_id: CYRVANA_WORKSPACE_ID,
      quiz_id: input.quiz_id,
      session_id: input.session_id,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim() || null,
      custom_fields: {
        consent: true,
        consent_at: now,
        client_ip: clientIp,
      },
    })
    .select("id")
    .single();

  if (lErr || !lead) {
    console.error("[captureLead] insert failed", lErr);
    return {
      ok: false,
      reason: "server_error",
      message: "We couldn't save your details. Please try again.",
    };
  }

  // --- 7. Link the lead back to the session ---
  // Best-effort. If this fails, the lead is still saved; we just lose the
  // back-reference on the session, which is recoverable from leads.session_id.
  await supabase
    .from("sessions")
    .update({ lead_id: lead.id })
    .eq("id", input.session_id);

  // --- 8. Enqueue destination deliveries ---
  // Best-effort. If enqueue fails, the lead is still saved; admin can retry
  // delivery manually from the Destinations UI.
  // Per ARCHITECTURE.md §9: workspace-wide destinations (quiz_id IS NULL) and
  // quiz-specific destinations both apply; rows are inserted with status='pending'.
  //
  // Gated by FEATURE_DESTINATIONS env var. When disabled, leads still capture
  // normally and the CSV export from /admin/leads is the delivery mechanism.
  if (isDestinationsEnabled()) {
    try {
      const { data: destinations } = await supabase
        .from("destinations")
        .select("id, quiz_id")
        .eq("workspace_id", CYRVANA_WORKSPACE_ID)
        .eq("active", true)
        .or(`quiz_id.is.null,quiz_id.eq.${input.quiz_id}`);

      if (destinations && destinations.length > 0) {
        // Defensive embed unwrap.
        const quiz = Array.isArray(session.quizzes) ? session.quizzes[0] : session.quizzes;
        const tier = Array.isArray(session.result_tiers)
          ? session.result_tiers[0]
          : session.result_tiers;

        const payload = {
          email: input.email.trim().toLowerCase(),
          name: input.name.trim() || null,
          phone: null,  // not currently collected; reserved
          quiz_title: quiz?.title ?? null,
          quiz_slug: quiz?.slug ?? null,
          score: session.score ?? null,
          tier_title: tier?.title ?? null,
          captured_at: now,
        };

        await supabase.from("destination_deliveries").insert(
          destinations.map((d) => ({
            destination_id: d.id,
            lead_id: lead.id,
            payload,
            status: "pending",
          })),
        );
      }
    } catch (enqueueErr) {
      console.error("[captureLead] failed to enqueue destination deliveries", enqueueErr);
      // Intentionally don't propagate — the lead is the durable record.
    }
  }

  return { ok: true, lead_id: lead.id };
}
