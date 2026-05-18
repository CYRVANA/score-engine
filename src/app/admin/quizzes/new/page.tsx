import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "@/components/AdminShell";
import { QuizMetadataForm } from "../QuizMetadataForm";

export const dynamic = "force-dynamic";

/**
 * New quiz page at /admin/quizzes/new.
 *
 * Creates a draft quiz. Questions and tiers are added on the detail/edit
 * pages in piece 2.4b — at create time the quiz starts as an empty shell.
 */
export default async function NewQuizPage() {
  const profile = await requireAdmin();

  return (
    <AdminShell profile={profile}>
      <Link
        href="/admin/quizzes"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to quizzes
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">
          New quiz
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          Create a quiz
        </h1>
        <p className="mt-3 text-base text-muted">
          Start with the metadata. You&apos;ll add questions and result tiers after
          creating it.
        </p>
      </header>

      <div className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8">
        <QuizMetadataForm mode="create" />
      </div>

      <div className="mt-8 max-w-2xl rounded-lg border border-dashed border-border bg-background p-5">
        <h3 className="text-sm font-semibold text-foreground">After you create</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You&apos;ll land on the quiz detail page where you can add questions and
          result tiers (piece 2.4b — currently SQL-only). The quiz starts as a draft;
          publishing requires at least one question and one tier.
        </p>
      </div>
    </AdminShell>
  );
}
