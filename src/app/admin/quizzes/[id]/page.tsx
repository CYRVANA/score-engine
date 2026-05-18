import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { StatusControl } from "../StatusControl";
import { QuizActions } from "../QuizActions";
import { QuestionsManager } from "../QuestionsManager";
import { TiersManager } from "../TiersManager";
import type { QuestionForEdit } from "../QuestionEditor";
import type { TierForEdit } from "../TierEditor";
import type { CoverageTier } from "../CoverageBox";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;
type QuizStatus = "draft" | "published" | "archived";

type RawQuestion = {
  id: string;
  order_index: number;
  type: string;
  prompt: string;
  weight: number;
  options: Array<{ label: string; points: number }>;
};
type RawTier = {
  id: string;
  min_score: number;
  max_score: number;
  title: string;
  description: string | null;
  cta_label: string | null;
  cta_url: string | null;
};

/**
 * Quiz detail at /admin/quizzes/[id].
 *
 * Phase 2.4b: full inline editing. Questions and tiers are managed by client
 * components that handle local state and call Server Actions for persistence.
 */
export default async function QuizDetailPage({ params }: { params: RouteParams }) {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const { id } = await params;

  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select(
      `
      id,
      slug,
      title,
      description,
      category,
      segment,
      status,
      published_at,
      archived_at,
      created_at,
      questions ( id, order_index, type, prompt, weight, options ),
      result_tiers ( id, min_score, max_score, title, description, cta_label, cta_url )
    `,
    )
    .eq("id", id)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (error || !quiz) {
    notFound();
  }

  const questions: QuestionForEdit[] = ((quiz.questions ?? []) as RawQuestion[])
    .map((q) => ({
      id: q.id,
      order_index: q.order_index,
      prompt: q.prompt,
      weight: q.weight,
      options: (q.options ?? []).map((o) => ({ label: o.label, points: o.points })),
    }))
    .sort((a, b) => a.order_index - b.order_index);

  const tiers: TierForEdit[] = ((quiz.result_tiers ?? []) as RawTier[])
    .map((t) => ({
      id: t.id,
      min_score: t.min_score,
      max_score: t.max_score,
      title: t.title,
      description: t.description,
      cta_label: t.cta_label,
      cta_url: t.cta_url,
    }))
    .sort((a, b) => a.min_score - b.min_score);

  // Coverage box reads tiers as { min, max, title }; passing the trimmed shape.
  const coverageTiers: CoverageTier[] = tiers.map((t) => ({
    min_score: t.min_score,
    max_score: t.max_score,
    title: t.title,
  }));

  const status = (quiz.status as QuizStatus) ?? "draft";

  return (
    <AdminShell profile={profile}>
      <Link
        href="/admin/quizzes"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to quizzes
      </Link>

      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Quiz
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              {quiz.title}
            </h1>
            {quiz.description && (
              <p className="mt-3 text-base text-muted">{quiz.description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono text-xs text-muted">/q/{quiz.slug}</span>
              {status === "published" && (
                <a
                  href={`/q/${quiz.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  Open public URL ↗
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <StatusControl quizId={quiz.id} currentStatus={status} />
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/quizzes/${quiz.id}/edit`}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-border/30"
              >
                Edit metadata
              </Link>
              <QuizActions quizId={quiz.id} />
            </div>
          </div>
        </div>
      </header>

      {/* Quick facts */}
      <section className="grid gap-4 sm:grid-cols-4">
        <Fact label="Category" value={quiz.category ?? "—"} />
        <Fact label="Segment" value={quiz.segment ?? "—"} />
        <Fact label="Questions" value={questions.length.toString()} />
        <Fact label="Tiers" value={tiers.length.toString()} />
      </section>

      {/* Questions (includes coverage box at top) */}
      <div className="mt-10">
        <QuestionsManager
          quizId={quiz.id}
          initialQuestions={questions}
          tiers={coverageTiers}
        />
      </div>

      {/* Tiers */}
      <div className="mt-10">
        <TiersManager quizId={quiz.id} initialTiers={tiers} />
      </div>
    </AdminShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1.5 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
