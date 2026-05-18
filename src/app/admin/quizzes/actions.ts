"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

// =========================================================================
// Shared helpers
// =========================================================================
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateSlug(slug: string): string | null {
  if (slug.length < 2) return "Slug must be at least 2 characters.";
  if (slug.length > 80) return "Slug must be 80 characters or fewer.";
  if (!SLUG_RE.test(slug))
    return "Slug must be lowercase letters, numbers, and hyphens only (no spaces or special characters).";
  return null;
}

/**
 * Ownership check used by every quiz mutator. Returns the quiz ID if the
 * admin owns it, or an error message if not. Avoids leaking whether a quiz
 * exists vs. is in another workspace.
 */
async function assertQuizOwnership(
  quizId: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, workspace_id")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (error || !data) return { ok: false, error: "Quiz not found in your workspace." };
  return { ok: true, workspaceId: data.workspace_id };
}

function revalidateQuiz(quizId: string) {
  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${quizId}`);
}

// =========================================================================
// Status change — unchanged from 2.3
// =========================================================================
export type StatusChangeResult =
  | { ok: true; new_status: string }
  | { ok: false; error: string };

export async function changeQuizStatus(
  quizId: string,
  newStatus: "draft" | "published" | "archived",
): Promise<StatusChangeResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: quiz, error: qErr } = await supabase
    .from("quizzes")
    .select("id, workspace_id, status")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (qErr || !quiz) return { ok: false, error: "Quiz not found in your workspace." };

  if (newStatus === "published") {
    const [{ count: questionCount }, { count: tierCount }] = await Promise.all([
      supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("quiz_id", quizId),
      supabase
        .from("result_tiers")
        .select("*", { count: "exact", head: true })
        .eq("quiz_id", quizId),
    ]);
    if ((questionCount ?? 0) === 0)
      return { ok: false, error: "Add at least one question before publishing this quiz." };
    if ((tierCount ?? 0) === 0)
      return {
        ok: false,
        error: "Add at least one result tier before publishing this quiz.",
      };
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "published" && quiz.status !== "published") {
    updates.published_at = new Date().toISOString();
  }
  if (newStatus === "archived") updates.archived_at = new Date().toISOString();

  const { error: uErr } = await supabase.from("quizzes").update(updates).eq("id", quizId);
  if (uErr) return { ok: false, error: uErr.message };

  revalidateQuiz(quizId);
  return { ok: true, new_status: newStatus };
}

// =========================================================================
// createQuiz / updateQuizMetadata / cloneQuiz / deleteQuiz — from 2.4a
// =========================================================================
export type QuizMetadataInput = {
  title: string;
  slug: string;
  description: string;
  category: string;
  segment: string;
};

export type CreateQuizResult =
  | { ok: true; quiz_id: string; slug: string }
  | { ok: false; error: string; field?: keyof QuizMetadataInput };

export async function createQuiz(input: QuizMetadataInput): Promise<CreateQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required.", field: "title" };
  if (title.length > 200)
    return { ok: false, error: "Title must be 200 characters or fewer.", field: "title" };

  const slug = normalizeSlug(input.slug);
  const slugErr = validateSlug(slug);
  if (slugErr) return { ok: false, error: slugErr, field: "slug" };

  const { count: dupeCount } = await supabase
    .from("quizzes")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", profile.workspace_id)
    .eq("slug", slug);
  if ((dupeCount ?? 0) > 0)
    return {
      ok: false,
      error: "A quiz with that slug already exists in your workspace.",
      field: "slug",
    };

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      workspace_id: profile.workspace_id,
      slug,
      title,
      description: input.description.trim() || null,
      category: input.category.trim() || null,
      segment: input.segment.trim() || null,
      status: "draft",
    })
    .select("id, slug")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create quiz." };

  revalidatePath("/admin/quizzes");
  return { ok: true, quiz_id: data.id, slug: data.slug };
}

export type UpdateQuizResult =
  | { ok: true }
  | { ok: false; error: string; field?: keyof QuizMetadataInput };

export async function updateQuizMetadata(
  quizId: string,
  input: QuizMetadataInput,
): Promise<UpdateQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: quiz, error: fetchErr } = await supabase
    .from("quizzes")
    .select("id, slug, published_at")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (fetchErr || !quiz) return { ok: false, error: "Quiz not found in your workspace." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required.", field: "title" };
  if (title.length > 200)
    return { ok: false, error: "Title must be 200 characters or fewer.", field: "title" };

  const newSlug = normalizeSlug(input.slug);
  const slugErr = validateSlug(newSlug);
  if (slugErr) return { ok: false, error: slugErr, field: "slug" };

  const slugChanged = newSlug !== quiz.slug;
  if (slugChanged && quiz.published_at)
    return {
      ok: false,
      error:
        "Can't change the slug of a quiz that's ever been published. Inbound links would break.",
      field: "slug",
    };

  if (slugChanged) {
    const { count: dupeCount } = await supabase
      .from("quizzes")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id)
      .eq("slug", newSlug)
      .neq("id", quizId);
    if ((dupeCount ?? 0) > 0)
      return { ok: false, error: "Another quiz already uses that slug.", field: "slug" };
  }

  const { error: uErr } = await supabase
    .from("quizzes")
    .update({
      title,
      slug: newSlug,
      description: input.description.trim() || null,
      category: input.category.trim() || null,
      segment: input.segment.trim() || null,
    })
    .eq("id", quizId);
  if (uErr) return { ok: false, error: uErr.message };

  revalidateQuiz(quizId);
  return { ok: true };
}

export type CloneQuizResult =
  | { ok: true; new_quiz_id: string; new_slug: string }
  | { ok: false; error: string };

export async function cloneQuiz(quizId: string): Promise<CloneQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: original, error: oErr } = await supabase
    .from("quizzes")
    .select(
      `
      id, slug, title, description, category, segment, settings,
      questions ( order_index, type, prompt, weight, options ),
      result_tiers ( min_score, max_score, title, description, cta_label, cta_url )
    `,
    )
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (oErr || !original) return { ok: false, error: "Quiz not found in your workspace." };

  let candidate = `${original.slug}-copy`;
  let attempt = 1;
  for (;;) {
    const { count } = await supabase
      .from("quizzes")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id)
      .eq("slug", candidate);
    if ((count ?? 0) === 0) break;
    attempt += 1;
    candidate = `${original.slug}-copy-${attempt}`;
    if (attempt > 50)
      return {
        ok: false,
        error: "Couldn't find an available slug for the clone. Rename the original first.",
      };
  }

  const { data: newQuiz, error: insertErr } = await supabase
    .from("quizzes")
    .insert({
      workspace_id: profile.workspace_id,
      parent_id: original.id,
      slug: candidate,
      title: `${original.title} (copy)`,
      description: original.description,
      category: original.category,
      segment: original.segment,
      settings: original.settings ?? {},
      status: "draft",
    })
    .select("id, slug")
    .single();
  if (insertErr || !newQuiz)
    return { ok: false, error: insertErr?.message ?? "Failed to clone quiz." };

  const questions = (original.questions ?? []) as Array<{
    order_index: number;
    type: string;
    prompt: string;
    weight: number;
    options: unknown;
  }>;
  if (questions.length > 0) {
    const { error: qErr } = await supabase.from("questions").insert(
      questions.map((q) => ({
        quiz_id: newQuiz.id,
        order_index: q.order_index,
        type: q.type,
        prompt: q.prompt,
        weight: q.weight,
        options: q.options,
      })),
    );
    if (qErr) {
      await supabase.from("quizzes").delete().eq("id", newQuiz.id);
      return { ok: false, error: `Couldn't copy questions: ${qErr.message}` };
    }
  }

  const tiers = (original.result_tiers ?? []) as Array<{
    min_score: number;
    max_score: number;
    title: string;
    description: string | null;
    cta_label: string | null;
    cta_url: string | null;
  }>;
  if (tiers.length > 0) {
    const { error: tErr } = await supabase.from("result_tiers").insert(
      tiers.map((t) => ({
        quiz_id: newQuiz.id,
        min_score: t.min_score,
        max_score: t.max_score,
        title: t.title,
        description: t.description,
        cta_label: t.cta_label,
        cta_url: t.cta_url,
      })),
    );
    if (tErr) {
      await supabase.from("quizzes").delete().eq("id", newQuiz.id);
      return { ok: false, error: `Couldn't copy tiers: ${tErr.message}` };
    }
  }

  revalidatePath("/admin/quizzes");
  return { ok: true, new_quiz_id: newQuiz.id, new_slug: newQuiz.slug };
}

export type DeleteQuizResult =
  | { ok: true }
  | { ok: false; error: string; lead_count?: number };

export async function deleteQuiz(quizId: string): Promise<DeleteQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: quiz, error: fetchErr } = await supabase
    .from("quizzes")
    .select("id")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (fetchErr || !quiz) return { ok: false, error: "Quiz not found in your workspace." };

  const { count: leadCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("quiz_id", quizId);
  if ((leadCount ?? 0) > 0)
    return {
      ok: false,
      error:
        "This quiz has leads attached. Archive it instead of deleting to preserve the lead history.",
      lead_count: leadCount ?? 0,
    };

  const { error: delErr } = await supabase.from("quizzes").delete().eq("id", quizId);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath("/admin/quizzes");
  return { ok: true };
}

export async function createQuizFormAction(formData: FormData) {
  const result = await createQuiz({
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? ""),
    segment: String(formData.get("segment") ?? ""),
  });
  if (result.ok) redirect(`/admin/quizzes/${result.quiz_id}`);
  return result;
}

export async function updateQuizFormAction(quizId: string, formData: FormData) {
  return updateQuizMetadata(quizId, {
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? ""),
    segment: String(formData.get("segment") ?? ""),
  });
}

// =========================================================================
// QUESTIONS — Phase 2.4b NEW
// =========================================================================
export type QuestionOption = { label: string; points: number };

export type QuestionInput = {
  prompt: string;
  weight: number;
  options: QuestionOption[];
};

export type QuestionMutationResult =
  | { ok: true; question_id: string }
  | { ok: false; error: string };

function validateQuestion(input: QuestionInput): string | null {
  const prompt = input.prompt.trim();
  if (!prompt) return "Question prompt is required.";
  if (prompt.length > 500) return "Prompt must be 500 characters or fewer.";
  if (input.weight < 1 || input.weight > 10) return "Weight must be between 1 and 10.";
  if (!Array.isArray(input.options) || input.options.length < 2)
    return "Question must have at least 2 options.";
  if (input.options.length > 12) return "Question can have at most 12 options.";
  for (const opt of input.options) {
    if (!opt.label || !opt.label.trim()) return "Every option must have a label.";
    if (opt.label.length > 300) return "Option labels must be 300 characters or fewer.";
    if (!Number.isInteger(opt.points) || opt.points < 0 || opt.points > 100)
      return "Option points must be integers between 0 and 100.";
  }
  return null;
}

/**
 * Add a new question to a quiz. Inserted at the end (order_index = max + 1).
 */
export async function addQuestion(
  quizId: string,
  input: QuestionInput,
): Promise<QuestionMutationResult> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const validation = validateQuestion(input);
  if (validation) return { ok: false, error: validation };

  const supabase = createServiceRoleClient();

  // Find the current max order_index for this quiz.
  const { data: existing } = await supabase
    .from("questions")
    .select("order_index")
    .eq("quiz_id", quizId)
    .order("order_index", { ascending: false })
    .limit(1);
  const nextIndex = ((existing?.[0]?.order_index ?? 0) as number) + 1;

  const { data, error } = await supabase
    .from("questions")
    .insert({
      quiz_id: quizId,
      order_index: nextIndex,
      type: "single_choice",
      prompt: input.prompt.trim(),
      weight: input.weight,
      options: input.options.map((o) => ({
        label: o.label.trim(),
        points: o.points,
      })),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to add question." };

  revalidateQuiz(quizId);
  return { ok: true, question_id: data.id };
}

/**
 * Update one question's prompt, weight, and options.
 */
export async function updateQuestion(
  quizId: string,
  questionId: string,
  input: QuestionInput,
): Promise<QuestionMutationResult> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const validation = validateQuestion(input);
  if (validation) return { ok: false, error: validation };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("questions")
    .update({
      prompt: input.prompt.trim(),
      weight: input.weight,
      options: input.options.map((o) => ({ label: o.label.trim(), points: o.points })),
    })
    .eq("id", questionId)
    .eq("quiz_id", quizId);
  if (error) return { ok: false, error: error.message };

  revalidateQuiz(quizId);
  return { ok: true, question_id: questionId };
}

/**
 * Delete a question. FK cascade removes any answers referencing it.
 * Sessions retain their score (denormalized).
 */
export async function deleteQuestion(
  quizId: string,
  questionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("questions")
    .delete()
    .eq("id", questionId)
    .eq("quiz_id", quizId);
  if (error) return { ok: false, error: error.message };

  revalidateQuiz(quizId);
  return { ok: true };
}

/**
 * Move a question up or down by swapping order_index with its neighbor.
 */
export async function moveQuestion(
  quizId: string,
  questionId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const supabase = createServiceRoleClient();

  const { data: questions, error: listErr } = await supabase
    .from("questions")
    .select("id, order_index")
    .eq("quiz_id", quizId)
    .order("order_index");
  if (listErr || !questions) return { ok: false, error: listErr?.message ?? "Failed." };

  const idx = questions.findIndex((q) => q.id === questionId);
  if (idx === -1) return { ok: false, error: "Question not found." };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= questions.length)
    return { ok: false, error: "Question is already at the boundary." };

  const a = questions[idx];
  const b = questions[swapIdx];

  // Swap in two updates. Use a temp index to avoid unique-index conflicts
  // if one is added later. Currently no unique constraint on (quiz_id, order_index)
  // so a direct two-step swap works, but we use a sentinel to be safe.
  const TEMP = -1;
  const { error: e1 } = await supabase
    .from("questions")
    .update({ order_index: TEMP })
    .eq("id", a.id);
  if (e1) return { ok: false, error: e1.message };

  const { error: e2 } = await supabase
    .from("questions")
    .update({ order_index: a.order_index })
    .eq("id", b.id);
  if (e2) return { ok: false, error: e2.message };

  const { error: e3 } = await supabase
    .from("questions")
    .update({ order_index: b.order_index })
    .eq("id", a.id);
  if (e3) return { ok: false, error: e3.message };

  revalidateQuiz(quizId);
  return { ok: true };
}

// =========================================================================
// TIERS — Phase 2.4b NEW
// =========================================================================
export type TierInput = {
  min_score: number;
  max_score: number;
  title: string;
  description: string;
  cta_label: string;
  cta_url: string;
};

export type TierMutationResult =
  | { ok: true; tier_id: string }
  | { ok: false; error: string };

function validateTier(input: TierInput): string | null {
  if (!input.title.trim()) return "Tier title is required.";
  if (input.title.length > 200) return "Title must be 200 characters or fewer.";
  if (!Number.isInteger(input.min_score) || input.min_score < 0)
    return "Min score must be a non-negative integer.";
  if (!Number.isInteger(input.max_score) || input.max_score < 0)
    return "Max score must be a non-negative integer.";
  if (input.min_score > input.max_score)
    return "Min score must be less than or equal to max score.";
  if (input.cta_url && input.cta_url.trim()) {
    const url = input.cta_url.trim();
    if (!/^https?:\/\//i.test(url))
      return "CTA URL must start with http:// or https://";
  }
  // CTA label required if URL set, vice versa.
  if (
    (input.cta_label.trim() && !input.cta_url.trim()) ||
    (!input.cta_label.trim() && input.cta_url.trim())
  )
    return "Set both CTA label and URL, or neither.";
  return null;
}

export async function addTier(
  quizId: string,
  input: TierInput,
): Promise<TierMutationResult> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const validation = validateTier(input);
  if (validation) return { ok: false, error: validation };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("result_tiers")
    .insert({
      quiz_id: quizId,
      min_score: input.min_score,
      max_score: input.max_score,
      title: input.title.trim(),
      description: input.description.trim() || null,
      cta_label: input.cta_label.trim() || null,
      cta_url: input.cta_url.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to add tier." };

  revalidateQuiz(quizId);
  return { ok: true, tier_id: data.id };
}

export async function updateTier(
  quizId: string,
  tierId: string,
  input: TierInput,
): Promise<TierMutationResult> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const validation = validateTier(input);
  if (validation) return { ok: false, error: validation };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("result_tiers")
    .update({
      min_score: input.min_score,
      max_score: input.max_score,
      title: input.title.trim(),
      description: input.description.trim() || null,
      cta_label: input.cta_label.trim() || null,
      cta_url: input.cta_url.trim() || null,
    })
    .eq("id", tierId)
    .eq("quiz_id", quizId);
  if (error) return { ok: false, error: error.message };

  revalidateQuiz(quizId);
  return { ok: true, tier_id: tierId };
}

export async function deleteTier(
  quizId: string,
  tierId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const own = await assertQuizOwnership(quizId);
  if (!own.ok) return { ok: false, error: own.error };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("result_tiers")
    .delete()
    .eq("id", tierId)
    .eq("quiz_id", quizId);
  if (error) return { ok: false, error: error.message };

  revalidateQuiz(quizId);
  return { ok: true };
}
