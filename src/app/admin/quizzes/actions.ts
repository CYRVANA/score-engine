"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

// =========================================================================
// Slug validation — shared between create and update.
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

// =========================================================================
// Status changes — unchanged from Phase 2.3
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

  if (qErr || !quiz) {
    return { ok: false, error: "Quiz not found in your workspace." };
  }

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

    if ((questionCount ?? 0) === 0) {
      return { ok: false, error: "Add at least one question before publishing this quiz." };
    }
    if ((tierCount ?? 0) === 0) {
      return {
        ok: false,
        error: "Add at least one result tier before publishing this quiz.",
      };
    }
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "published" && quiz.status !== "published") {
    updates.published_at = new Date().toISOString();
  }
  if (newStatus === "archived") {
    updates.archived_at = new Date().toISOString();
  }

  const { error: uErr } = await supabase.from("quizzes").update(updates).eq("id", quizId);
  if (uErr) {
    return { ok: false, error: uErr.message };
  }

  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${quizId}`);
  return { ok: true, new_status: newStatus };
}

// =========================================================================
// createQuiz — Phase 2.4a NEW
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

/**
 * Create a new quiz. Brand-new quizzes start as draft with no questions or
 * tiers — that's fine because the publish guard from 2.3 blocks publishing
 * an empty quiz.
 */
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

  // Uniqueness within the workspace.
  const { count: dupeCount } = await supabase
    .from("quizzes")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", profile.workspace_id)
    .eq("slug", slug);

  if ((dupeCount ?? 0) > 0) {
    return {
      ok: false,
      error: "A quiz with that slug already exists in your workspace.",
      field: "slug",
    };
  }

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

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create quiz." };
  }

  revalidatePath("/admin/quizzes");
  return { ok: true, quiz_id: data.id, slug: data.slug };
}

// =========================================================================
// updateQuizMetadata — Phase 2.4a NEW
// =========================================================================
export type UpdateQuizResult =
  | { ok: true }
  | { ok: false; error: string; field?: keyof QuizMetadataInput };

/**
 * Update a quiz's metadata. Slug is locked once the quiz has ever been
 * published (preserves inbound links).
 */
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

  if (fetchErr || !quiz) {
    return { ok: false, error: "Quiz not found in your workspace." };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required.", field: "title" };
  if (title.length > 200)
    return { ok: false, error: "Title must be 200 characters or fewer.", field: "title" };

  const newSlug = normalizeSlug(input.slug);
  const slugErr = validateSlug(newSlug);
  if (slugErr) return { ok: false, error: slugErr, field: "slug" };

  // Slug change check.
  const slugChanged = newSlug !== quiz.slug;
  if (slugChanged && quiz.published_at) {
    return {
      ok: false,
      error:
        "Can't change the slug of a quiz that's ever been published. Inbound links would break.",
      field: "slug",
    };
  }

  // Uniqueness within workspace (excluding self).
  if (slugChanged) {
    const { count: dupeCount } = await supabase
      .from("quizzes")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id)
      .eq("slug", newSlug)
      .neq("id", quizId);

    if ((dupeCount ?? 0) > 0) {
      return {
        ok: false,
        error: "Another quiz already uses that slug.",
        field: "slug",
      };
    }
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

  if (uErr) {
    return { ok: false, error: uErr.message };
  }

  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${quizId}`);
  return { ok: true };
}

// =========================================================================
// cloneQuiz — Phase 2.4a NEW
// =========================================================================
export type CloneQuizResult =
  | { ok: true; new_quiz_id: string; new_slug: string }
  | { ok: false; error: string };

/**
 * Clone a quiz including all its questions, options, and tiers.
 *
 * The new quiz:
 *   - status='draft'
 *   - slug = <original-slug>-copy (with -copy-2, -copy-3 as needed for uniqueness)
 *   - parent_id pointing at the original
 *   - segment/category copied from the original; admin can change in edit form
 *
 * IDs are regenerated for all child rows so the originals are untouched.
 */
export async function cloneQuiz(quizId: string): Promise<CloneQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Fetch the original with its children in one round-trip.
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

  if (oErr || !original) {
    return { ok: false, error: "Quiz not found in your workspace." };
  }

  // Find an available slug.
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
    if (attempt > 50) {
      return {
        ok: false,
        error: "Couldn't find an available slug for the clone. Rename the original first.",
      };
    }
  }

  // Insert the new quiz.
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

  if (insertErr || !newQuiz) {
    return { ok: false, error: insertErr?.message ?? "Failed to clone quiz." };
  }

  // Copy questions (omit IDs; new ones generated server-side).
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
      // Roll back the new quiz row so we don't leave a half-cloned shell.
      await supabase.from("quizzes").delete().eq("id", newQuiz.id);
      return { ok: false, error: `Couldn't copy questions: ${qErr.message}` };
    }
  }

  // Copy tiers.
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

// =========================================================================
// deleteQuiz — Phase 2.4a NEW
// =========================================================================
export type DeleteQuizResult =
  | { ok: true }
  | { ok: false; error: string; lead_count?: number };

/**
 * Delete a quiz, but only if it has zero leads. If leads exist, refuse and
 * tell the admin to archive instead. Protects historical lead data.
 */
export async function deleteQuiz(quizId: string): Promise<DeleteQuizResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Verify ownership.
  const { data: quiz, error: fetchErr } = await supabase
    .from("quizzes")
    .select("id")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (fetchErr || !quiz) {
    return { ok: false, error: "Quiz not found in your workspace." };
  }

  // Count leads.
  const { count: leadCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("quiz_id", quizId);

  if ((leadCount ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This quiz has leads attached. Archive it instead of deleting to preserve the lead history.",
      lead_count: leadCount ?? 0,
    };
  }

  // Hard delete. FK cascades remove questions, tiers, sessions, answers.
  const { error: delErr } = await supabase.from("quizzes").delete().eq("id", quizId);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  revalidatePath("/admin/quizzes");
  return { ok: true };
}

// =========================================================================
// Server Action wrappers used by forms (FormData-based)
// =========================================================================
export async function createQuizFormAction(formData: FormData) {
  const result = await createQuiz({
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? ""),
    segment: String(formData.get("segment") ?? ""),
  });

  if (result.ok) {
    redirect(`/admin/quizzes/${result.quiz_id}`);
  }
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
