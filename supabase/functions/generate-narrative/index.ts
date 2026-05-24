// score-engine — AI narrative + email delivery worker.
// Runs every 60 seconds via pg_cron. Two responsibilities per tick:
//
//   1. Drain ai_narratives rows with status="pending" or "retrying":
//      call Anthropic, save the narrative, set status="delivered".
//
//   2. Drain ai_narratives rows with status="delivered" and email_status="pending":
//      build the result email, send via Resend, mark email_status="sent".
//
// Bundling both into one worker keeps the result-email latency low: a freshly
// generated narrative gets emailed in the same worker run that produced it,
// not a minute later on the next cron tick.
//
// See docs/ARCHITECTURE.md for design.
//
// Deploy:
//   supabase functions deploy generate-narrative
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL                — auto-set
//   SUPABASE_SERVICE_ROLE_KEY   — auto-set
//   ANTHROPIC_API_KEY           — required for narrative generation
//   RESEND_API_KEY              — required for email sending (Phase 3b)
//   EMAIL_FROM_ADDRESS          — optional, defaults to notifications@send.cyrvana.com
//   EMAIL_REPLY_TO              — optional, defaults to info@cyrvana.com
//   PUBLIC_SITE_URL             — optional, defaults to https://assess.cyrvana.com
//   FEATURE_EMAIL_NARRATIVES    — if "true", attempt email; if "false" or unset, skip

import { createClient } from "jsr:@supabase/supabase-js@2";
import { renderEmailHtml, renderEmailText, type EmailRenderInput } from "./email-template.ts";

// ============================================================================
// Configuration
// ============================================================================
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 4;
// Exponential backoff in seconds: 30s, 2m, 8m, 30m.
const BACKOFF_SECONDS = [30, 120, 480, 1800];
const ANTHROPIC_TIMEOUT_MS = 45000;
const MAX_OUTPUT_TOKENS = 800;
const RESEND_TIMEOUT_MS = 20000;
const MAX_EMAIL_ATTEMPTS = 4;

const DEFAULT_FROM = "notifications@send.cyrvana.com";
const DEFAULT_REPLY_TO = "info@cyrvana.com";
const DEFAULT_SITE_URL = "https://assess.cyrvana.com";
const DEFAULT_APP_NAME = "score-engine";

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
  quiz_slug: string;
  quiz_description: string | null;
  tier_title: string | null;
  tier_description: string | null;
  tier_cta_label: string | null;
  tier_cta_url: string | null;
  answers_summary: string;
  // Lead fields are only present once captureLead has created the lead row.
  // The narrative is enqueued at lead capture time so these should always be
  // present in practice, but we guard against null anyway.
  recipient_email: string | null;
  recipient_name: string | null;
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
  // 0. Drain emails that are pending for already-generated narratives.
  //    These are rows where the narrative succeeded but the email failed
  //    on a previous tick (or was deferred because email delivery wasn't
  //    enabled at the time).
  // ==========================================================================
  const emailStats = await drainPendingEmails(supabase);

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
      JSON.stringify({
        ok: true,
        processed: 0,
        emails: emailStats,
        durationMs: Date.now() - startedAt,
      }),
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

      // Inline email send (best-effort). Lets the prospect receive their
      // email seconds after the narrative is ready, rather than waiting
      // for the next cron tick. Failed sends are picked up in the
      // separate "pending emails" pass on subsequent ticks.
      await tryDeliverEmail(supabase, {
        narrative_id: n.id,
        session_id: n.session_id,
        narrative_body: result.body,
        context,
        previous_attempts: 0,
      });
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
      emails: emailStats,
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
      quizzes:quiz_id ( title, slug, description ),
      result_tiers:result_tier_id ( title, description, cta_label, cta_url ),
      leads:lead_id ( email, name ),
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
  const lead = session.leads
    ? Array.isArray(session.leads)
      ? session.leads[0]
      : session.leads
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
    quiz_slug: quiz?.slug ?? "",
    quiz_description: quiz?.description ?? null,
    tier_title: tier?.title ?? null,
    tier_description: tier?.description ?? null,
    tier_cta_label: tier?.cta_label ?? null,
    tier_cta_url: tier?.cta_url ?? null,
    answers_summary,
    recipient_email: lead?.email ?? null,
    recipient_name: lead?.name ?? null,
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

// ============================================================================
// Email delivery (Phase 3b)
// ============================================================================

type EmailDeliveryStats = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Drain narratives with status=delivered + email_status=pending. Used to
 * retry emails that failed on previous runs (or that were deferred when
 * email delivery wasn't enabled at narrative-generation time).
 */
async function drainPendingEmails(
  supabase: ReturnType<typeof createClient>,
): Promise<EmailDeliveryStats> {
  const stats: EmailDeliveryStats = { attempted: 0, sent: 0, failed: 0, skipped: 0 };

  // If email feature is disabled, skip this work entirely (and don't churn
  // the DB by marking everything skipped — just leave them pending for when
  // the flag is flipped on).
  if (!isEmailEnabled()) return stats;

  const { data: rows } = await supabase
    .from("ai_narratives")
    .select("id, session_id, body, email_attempts")
    .eq("status", "delivered")
    .eq("email_status", "pending")
    .order("delivered_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!rows || rows.length === 0) return stats;

  for (const row of rows as Array<{
    id: string;
    session_id: string;
    body: string | null;
    email_attempts: number;
  }>) {
    if (!row.body) continue;
    stats.attempted += 1;
    const context = await loadSessionContext(supabase, row.session_id);
    if (!context) {
      await supabase
        .from("ai_narratives")
        .update({
          email_status: "failed",
          email_last_error: "session_context_missing",
          email_attempts: row.email_attempts + 1,
        })
        .eq("id", row.id);
      stats.failed += 1;
      continue;
    }

    const result = await tryDeliverEmail(supabase, {
      narrative_id: row.id,
      session_id: row.session_id,
      narrative_body: row.body,
      context,
      previous_attempts: row.email_attempts,
    });

    if (result === "sent") stats.sent += 1;
    else if (result === "skipped") stats.skipped += 1;
    else stats.failed += 1;
  }

  return stats;
}

/**
 * Attempt to deliver one email. Updates the ai_narratives row with the
 * resulting email_status, message_id, and error tracking.
 *
 * Returns: 'sent' | 'failed' | 'skipped'
 */
async function tryDeliverEmail(
  supabase: ReturnType<typeof createClient>,
  input: {
    narrative_id: string;
    session_id: string;
    narrative_body: string;
    context: SessionContext;
    previous_attempts: number;
  },
): Promise<"sent" | "failed" | "skipped"> {
  // Feature flag check
  if (!isEmailEnabled()) {
    // Leave email_status="pending" so it can be picked up later if the
    // flag is enabled. Don't mark it skipped — that's a terminal state.
    return "skipped";
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    await supabase
      .from("ai_narratives")
      .update({
        email_status: "failed",
        email_last_error: "RESEND_API_KEY missing",
        email_attempts: input.previous_attempts + 1,
      })
      .eq("id", input.narrative_id);
    return "failed";
  }

  if (!input.context.recipient_email) {
    await supabase
      .from("ai_narratives")
      .update({
        email_status: "failed",
        email_last_error: "recipient_email missing",
        email_attempts: input.previous_attempts + 1,
      })
      .eq("id", input.narrative_id);
    return "failed";
  }

  // Build the email payload from context + narrative.
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? DEFAULT_SITE_URL;
  const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") ?? DEFAULT_FROM;
  const replyTo = Deno.env.get("EMAIL_REPLY_TO") ?? DEFAULT_REPLY_TO;
  const appName = Deno.env.get("APP_NAME") ?? DEFAULT_APP_NAME;

  const renderInput: EmailRenderInput = {
    recipient_name: input.context.recipient_name,
    recipient_email: input.context.recipient_email,
    quiz_title: input.context.quiz_title,
    quiz_slug: input.context.quiz_slug,
    score: input.context.score,
    tier_title: input.context.tier_title,
    tier_description: input.context.tier_description,
    tier_cta_label: input.context.tier_cta_label,
    tier_cta_url: input.context.tier_cta_url,
    narrative_body: input.narrative_body,
    results_page_url: buildResultsPageUrl(
      siteUrl,
      input.context.quiz_slug,
      input.session_id,
    ),
    app_name: appName,
    site_url: siteUrl,
    contact_email: replyTo,
  };

  const html = renderEmailHtml(renderInput);
  const text = renderEmailText(renderInput);

  const subject = buildSubject(input.context);

  const result = await sendViaResend(resendKey, {
    from: fromAddress,
    to: input.context.recipient_email,
    reply_to: replyTo,
    subject,
    html,
    text,
  });

  if (result.ok) {
    await supabase
      .from("ai_narratives")
      .update({
        email_status: "sent",
        email_sent_at: new Date().toISOString(),
        email_attempts: input.previous_attempts + 1,
        email_message_id: result.message_id,
        email_last_error: null,
      })
      .eq("id", input.narrative_id);
    return "sent";
  }

  const nextAttempt = input.previous_attempts + 1;
  if (nextAttempt >= MAX_EMAIL_ATTEMPTS || !result.retriable) {
    await supabase
      .from("ai_narratives")
      .update({
        email_status: "failed",
        email_attempts: nextAttempt,
        email_last_error: result.error,
      })
      .eq("id", input.narrative_id);
    return "failed";
  }
  // Retriable: just bump the counter and last_error; next worker tick picks it up.
  await supabase
    .from("ai_narratives")
    .update({
      email_attempts: nextAttempt,
      email_last_error: result.error,
    })
    .eq("id", input.narrative_id);
  return "failed";
}

/**
 * Send an email via Resend's REST API.
 */
async function sendViaResend(
  apiKey: string,
  payload: {
    from: string;
    to: string;
    reply_to: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<
  | { ok: true; message_id: string }
  | { ok: false; error: string; retriable: boolean }
> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        reply_to: payload.reply_to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: `Resend ${response.status}: auth failed`,
        retriable: false,
      };
    }
    if (response.status === 422) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Resend 422 validation: ${text.slice(0, 400)}`,
        retriable: false,
      };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const retriable = response.status >= 500 || response.status === 429;
      return {
        ok: false,
        error: `Resend ${response.status}: ${text.slice(0, 400)}`,
        retriable,
      };
    }

    const data = await response.json();
    return { ok: true, message_id: data.id ?? "unknown" };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("abort")) {
      return { ok: false, error: "Resend request timed out", retriable: true };
    }
    return { ok: false, error: `Network error: ${err}`, retriable: true };
  }
}

function isEmailEnabled(): boolean {
  return Deno.env.get("FEATURE_EMAIL_NARRATIVES") === "true";
}

function buildSubject(ctx: SessionContext): string {
  if (ctx.tier_title) {
    return `Your results: "${ctx.quiz_title}" — ${ctx.tier_title}`;
  }
  return `Your results: "${ctx.quiz_title}"`;
}

function buildResultsPageUrl(
  siteUrl: string,
  quizSlug: string,
  sessionId: string,
): string {
  // Results URLs follow /q/<slug>/results?s=<session_id> — the public
  // results page uses the session id as the access token.
  return `${siteUrl.replace(/\/$/, "")}/q/${quizSlug}/results?s=${sessionId}`;
}
