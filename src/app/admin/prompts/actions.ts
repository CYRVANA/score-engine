"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

// ============================================================================
// Save a new prompt template (always creates a new row to preserve history)
// ============================================================================
export type SavePromptInput = {
  name: string;
  body: string;
  model: string;
  activate: boolean;
};

export type SavePromptResult =
  | { ok: true; template_id: string }
  | { ok: false; error: string };

export async function savePromptTemplate(
  input: SavePromptInput,
): Promise<SavePromptResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const name = input.name.trim();
  const body = input.body.trim();
  const model = input.model.trim();

  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 200) return { ok: false, error: "Name must be 200 characters or fewer." };
  if (!body) return { ok: false, error: "Prompt body is required." };
  if (body.length > 50000)
    return { ok: false, error: "Prompt body must be 50,000 characters or fewer." };
  if (!model) return { ok: false, error: "Model is required." };

  // If activating, deactivate the current active template first (single-active invariant).
  if (input.activate) {
    await supabase
      .from("prompt_templates")
      .update({ is_active: false })
      .eq("workspace_id", profile.workspace_id)
      .eq("is_active", true);
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .insert({
      workspace_id: profile.workspace_id,
      name,
      body,
      model,
      is_active: input.activate,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to save prompt." };
  }

  revalidatePath("/admin/prompts");
  return { ok: true, template_id: data.id };
}

// ============================================================================
// Activate an existing prompt template
// ============================================================================
export async function activatePromptTemplate(
  templateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Verify the template belongs to this workspace.
  const { data: template, error: fetchErr } = await supabase
    .from("prompt_templates")
    .select("id")
    .eq("id", templateId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (fetchErr || !template) return { ok: false, error: "Template not found." };

  // Deactivate current active.
  await supabase
    .from("prompt_templates")
    .update({ is_active: false })
    .eq("workspace_id", profile.workspace_id)
    .eq("is_active", true);

  // Activate the new one.
  const { error: actErr } = await supabase
    .from("prompt_templates")
    .update({ is_active: true })
    .eq("id", templateId);
  if (actErr) return { ok: false, error: actErr.message };

  revalidatePath("/admin/prompts");
  return { ok: true };
}

// ============================================================================
// Preview a prompt against the most recent session for a quiz
// (calls Anthropic with the proposed prompt body and returns the narrative)
// ============================================================================
export type PreviewPromptResult =
  | { ok: true; narrative: string; rendered_prompt: string }
  | { ok: false; error: string };

export async function previewPromptAgainstLatest(
  quizId: string,
  promptBody: string,
  model: string,
): Promise<PreviewPromptResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is not configured. Set it in your Netlify env vars.",
    };
  }

  // Verify quiz ownership.
  const { data: quiz, error: qErr } = await supabase
    .from("quizzes")
    .select("id, workspace_id")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (qErr || !quiz) return { ok: false, error: "Quiz not found in your workspace." };

  // Find the most recent completed session on this quiz.
  const { data: session } = await supabase
    .from("sessions")
    .select(
      `
      id, score,
      quizzes:quiz_id ( title, description ),
      result_tiers:result_tier_id ( title, description ),
      answers (
        points, value,
        questions:question_id ( prompt, order_index )
      )
    `,
    )
    .eq("quiz_id", quizId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return {
      ok: false,
      error:
        "No completed sessions on this quiz yet. Take the quiz once (or pick another quiz) to generate a preview.",
    };
  }

  const quizEmbed = Array.isArray(session.quizzes) ? session.quizzes[0] : session.quizzes;
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

  const renderedPrompt = promptBody
    .replace(/\{\{quiz_title\}\}/g, quizEmbed?.title ?? "Assessment")
    .replace(/\{\{quiz_description\}\}/g, quizEmbed?.description ?? "")
    .replace(/\{\{tier_title\}\}/g, tier?.title ?? "(no tier)")
    .replace(/\{\{tier_description\}\}/g, tier?.description ?? "")
    .replace(/\{\{score\}\}/g, session.score?.toString() ?? "0")
    .replace(/\{\{answers_summary\}\}/g, answers_summary);

  // Call Anthropic directly.
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: renderedPrompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Anthropic ${response.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = await response.json();
    const textBlock = (data.content ?? []).find(
      (b: { type?: string }) => b.type === "text",
    );
    const narrative =
      typeof textBlock?.text === "string" ? textBlock.text.trim() : "";
    if (!narrative) {
      return { ok: false, error: "Anthropic returned empty content." };
    }

    return { ok: true, narrative, rendered_prompt: renderedPrompt };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error: ${err}` };
  }
}
