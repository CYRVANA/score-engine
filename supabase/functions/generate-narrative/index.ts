// score-engine — AI narrative worker.
// Runs every 60 seconds via pg_cron. Drains the ai_narratives outbox, calls
// the Anthropic API for each pending row, writes the result back.
//
// See docs/ARCHITECTURE.md for design.
//
// Deploy:
//   supabase functions deploy generate-narrative
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL                — auto-set
//   SUPABASE_SERVICE_ROLE_KEY   — auto-set
//   ANTHROPIC_API_KEY           — you set this

import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// Configuration
// ============================================================================
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 4;
// Exponential backoff in seconds: 30s, 2m, 8m, 30m.
const BACKOFF_SECONDS = [30, 120, 480, 1800];
const ANTHROPIC_TIMEOUT_MS = 45000;
const MAX_OUTPUT_TOKENS = 800;

// ============================================================================
// Types
// ============================================================================
type NarrativeRow = {
  id: string;
  session_id: string;
  workspace_id: string;
  prompt_template_id: string | null;
  attempt_count: number;
  status: string;
};

type SessionContext = {
  score: number | null;
  quiz_title: string;
  quiz_description: string | null;
  tier_title: string | null;
  tier_description: string | null;
  answers_summary: string;
};

type GenerationResult =
  | {
      ok: true;
      body: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      latency_ms: number;
    }
  | { ok: false; error: string; retriable: boolean };

// ============================================================================
// Entry point
// ============================================================================
Deno.serve(async (_req: Request) => {
  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    console.error("[generate-narrative] missing required env vars");
    return new Response(
      JSON.stringify({ ok: false, error: "Missing env vars" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "public" },
    auth: { persistSession: false },
  });

  // ==========================================================================
  // 1. Pull due narratives.
  // ==========================================================================
  const { data: narratives, error: pullErr } = await supabase
    .from("ai_narratives")
    .select("id, session_id, workspace_id, prompt_template_id, attempt_count, status")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (pullErr) {
    console.error("[generate-narrative] failed to pull batch:", pullErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: pullErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!narratives || narratives.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, durationMs: Date.now() - startedAt }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Mark in_flight so concurrent invocations don't duplicate work.
  const ids = narratives.map((n: NarrativeRow) => n.id);
  await supabase
    .from("ai_narratives")
    .update({ status: "in_flight", last_attempt_at: new Date().toISOString() })
    .in("id", ids);

  let succeeded = 0;
  let failed = 0;

  // ==========================================================================
  // 2. Process each one (no per-destination grouping; the Anthropic call is
  //    expensive enough that batching isn't worthwhile here).
  // ==========================================================================
  for (const n of narratives as NarrativeRow[]) {
    const context = await loadSessionContext(supabase, n.session_id);
    if (!context) {
      await markFailed(supabase, n, "session_or_context_missing");
      failed++;
      continue;
    }

    const template = await loadPromptTemplate(
      supabase,
      n.prompt_template_id,
      n.workspace_id,
    );
    if (!template) {
      await markFailed(supabase, n, "no_active_prompt_template");
      failed++;
      continue;
    }

    const promptBody = renderPrompt(template.body, context);

    const result = await callAnthropic(
      anthropicKey,
      template.model,
      promptBody,
    );

    if (result.ok) {
      await supabase
        .from("ai_narratives")
        .update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
          attempt_count: n.attempt_count + 1,
          body: result.body,
          model: result.model,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          latency_ms: result.latency_ms,
          last_error: null,
        })
        .eq("id", n.id);
      succeeded++;
    } else {
      const nextAttempt = n.attempt_count + 1;
      if (nextAttempt >= MAX_ATTEMPTS || !result.retriable) {
        await supabase
          .from("ai_narratives")
          .update({
            status: "failed",
            attempt_count: nextAttempt,
            last_error: result.error,
          })
          .eq("id", n.id);
      } else {
        const backoffSec =
          BACKOFF_SECONDS[Math.min(nextAttempt, BACKOFF_SECONDS.length - 1)];
        const nextTime = new Date(Date.now() + backoffSec * 1000).toISOString();
        await supabase
          .from("ai_narratives")
          .update({
            status: "retrying",
            attempt_count: nextAttempt,
            next_attempt_at: nextTime,
            last_error: result.error,
          })
          .eq("id", n.id);
      }
      failed++;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: narratives.length,
      succeeded,
      failed,
      durationMs: Date.now() - startedAt,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

// ============================================================================
// Session context loader
// ============================================================================
async function loadSessionContext(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
): Promise<SessionContext | null> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      `
      score,
      quizzes:quiz_id ( title, description ),
      result_tiers:result_tier_id ( title, description ),
      answers (
        points,
        value,
        questions:question_id ( prompt, order_index )
      )
    `,
    )
    .eq("id", sessionId)
    .single();

  if (error || !session) return null;

  const quiz = Array.isArray(session.quizzes) ? session.quizzes[0] : session.quizzes;
  const tier = session.result_tiers
    ? Array.isArray(session.result_tiers)
      ? session.result_tiers[0]
      : session.result_tiers
    : null;

  type AnswerRow = {
    points: number;
    value: { option_index: number; option_label: string } | null;
    questions:
      | { prompt: string; order_index: number }
      | { prompt: string; order_index: number }[]
      | null;
  };

  const answers = ((session.answers ?? []) as AnswerRow[])
    .map((a) => ({
      points: a.points,
      label: a.value?.option_label ?? "(no selection)",
      question: Array.isArray(a.questions) ? a.questions[0] : a.questions,
    }))
    .filter((a) => a.question !== null && a.question !== undefined)
    .sort((a, b) => (a.question!.order_index ?? 0) - (b.question!.order_index ?? 0));

  const answers_summary = answers
    .map(
      (a, idx) =>
        `${idx + 1}. Q: ${a.question!.prompt}\n   A: ${a.label} (${a.points} pts)`,
    )
    .join("\n");

  return {
    score: session.score,
    quiz_title: quiz?.title ?? "Assessment",
    quiz_description: quiz?.description ?? null,
    tier_title: tier?.title ?? null,
    tier_description: tier?.description ?? null,
    answers_summary,
  };
}

// ============================================================================
// Prompt template loader
// ============================================================================
async function loadPromptTemplate(
  supabase: ReturnType<typeof createClient>,
  preferredId: string | null,
  workspaceId: string,
): Promise<{ body: string; model: string } | null> {
  // First preference: the template referenced on the narrative row (if it
  // still exists). Lets in-flight narratives keep their original prompt even
  // if the active prompt has been swapped since.
  if (preferredId) {
    const { data: byId } = await supabase
      .from("prompt_templates")
      .select("body, model")
      .eq("id", preferredId)
      .maybeSingle();
    if (byId) return byId;
  }

  // Fall back to the workspace's currently active template.
  const { data: active } = await supabase
    .from("prompt_templates")
    .select("body, model")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .maybeSingle();

  return active ?? null;
}

// ============================================================================
// Template rendering — replace {{placeholder}} tokens with context values.
// ============================================================================
function renderPrompt(template: string, ctx: SessionContext): string {
  return template
    .replace(/\{\{quiz_title\}\}/g, ctx.quiz_title)
    .replace(/\{\{quiz_description\}\}/g, ctx.quiz_description ?? "")
    .replace(/\{\{tier_title\}\}/g, ctx.tier_title ?? "(no tier)")
    .replace(/\{\{tier_description\}\}/g, ctx.tier_description ?? "")
    .replace(/\{\{score\}\}/g, ctx.score?.toString() ?? "0")
    .replace(/\{\{answers_summary\}\}/g, ctx.answers_summary);
}

// ============================================================================
// Anthropic API caller
// ============================================================================
async function callAnthropic(
  apiKey: string,
  model: string,
  promptBody: string,
): Promise<GenerationResult> {
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: promptBody }],
      }),
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startedAt;

    if (response.status === 401) {
      return {
        ok: false,
        error: "Anthropic 401: invalid API key",
        retriable: false,
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        error: "Anthropic 429: rate-limited",
        retriable: true,
      };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const retriable = response.status >= 500;
      return {
        ok: false,
        error: `Anthropic ${response.status}: ${text.slice(0, 500)}`,
        retriable,
      };
    }

    const data = await response.json();

    // Extract first text content block.
    const textBlock = (data.content ?? []).find(
      (b: { type?: string }) => b.type === "text",
    );
    const body =
      typeof textBlock?.text === "string" ? textBlock.text.trim() : "";

    if (!body) {
      return {
        ok: false,
        error: "Anthropic returned empty content",
        retriable: true,
      };
    }

    return {
      ok: true,
      body,
      model: data.model ?? model,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      latency_ms: latency,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("abort")) {
      return { ok: false, error: "Anthropic request timed out", retriable: true };
    }
    return { ok: false, error: `Network error: ${err}`, retriable: true };
  }
}

// ============================================================================
// Mark failed (terminal)
// ============================================================================
async function markFailed(
  supabase: ReturnType<typeof createClient>,
  narrative: NarrativeRow,
  reason: string,
) {
  await supabase
    .from("ai_narratives")
    .update({
      status: "failed",
      last_error: reason,
      attempt_count: narrative.attempt_count + 1,
    })
    .eq("id", narrative.id);
}
