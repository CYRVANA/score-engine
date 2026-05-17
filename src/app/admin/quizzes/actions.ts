"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type StatusChangeResult =
  | { ok: true; new_status: string }
  | { ok: false; error: string };

/**
 * Change a quiz's status (draft / published / archived).
 *
 * Guards (lenient publish guard per piece 2.3 decision):
 *   - Publishing requires at least 1 question AND at least 1 result_tier.
 *   - Score-range coverage is NOT enforced (informational on detail page).
 *   - Status changes are scoped to the admin's workspace.
 *
 * Status semantics:
 *   draft     — not publicly visible at /q/<slug>
 *   published — publicly visible; status='published' is the RLS filter
 *   archived  — not publicly visible; archived_at timestamp recorded
 */
export async function changeQuizStatus(
  quizId: string,
  newStatus: "draft" | "published" | "archived",
): Promise<StatusChangeResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Verify the quiz belongs to this workspace.
  const { data: quiz, error: qErr } = await supabase
    .from("quizzes")
    .select("id, workspace_id, status")
    .eq("id", quizId)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (qErr || !quiz) {
    return { ok: false, error: "Quiz not found in your workspace." };
  }

  // Publish guard.
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
      return {
        ok: false,
        error: "Add at least one question before publishing this quiz.",
      };
    }
    if ((tierCount ?? 0) === 0) {
      return {
        ok: false,
        error: "Add at least one result tier before publishing this quiz.",
      };
    }
  }

  // Apply the status change.
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

  // Invalidate cached pages so the change is reflected immediately.
  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${quizId}`);

  return { ok: true, new_status: newStatus };
}
