import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { QuizMetadataForm } from "../../QuizMetadataForm";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

/**
 * Edit quiz metadata at /admin/quizzes/[id]/edit.
 *
 * Slug is locked if the quiz has ever been published.
 */
export default async function EditQuizPage({ params }: { params: RouteParams }) {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const { id } = await params;

  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select("id, slug, title, description, category, segment, published_at")
    .eq("id", id)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (error || !quiz) {
    notFound();
  }

  const slugLocked = !!quiz.published_at;

  return (
    <AdminShell profile={profile}>
      <Link
        href={`/admin/quizzes/${id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to quiz
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">
          Edit quiz
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          {quiz.title}
        </h1>
      </header>

      <div className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8">
        <QuizMetadataForm
          mode="edit"
          quizId={id}
          slugLocked={slugLocked}
          initialValues={{
            title: quiz.title ?? "",
            slug: quiz.slug ?? "",
            description: quiz.description ?? "",
            category: quiz.category ?? "",
            segment: quiz.segment ?? "",
          }}
        />
      </div>
    </AdminShell>
  );
}
