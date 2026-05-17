import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { StatusControl } from "../StatusControl";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;
type QuizStatus = "draft" | "published" | "archived";

type QuestionOption = { label: string; points: number };
type Question = {
  id: string;
  order_index: number;
  type: string;
  prompt: string;
  weight: number;
  options: QuestionOption[];
};
type Tier = {
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
 * Phase 2.3: read-only. Shows questions, tiers, and computed score-range
 * coverage so authoring decisions are visible. The full editor is piece 2.4.
 *
 * Coverage analysis (informational, not blocking):
 *   - min_possible_score = sum over questions of (min option points × weight)
 *   - max_possible_score = sum over questions of (max option points × weight)
 *   - Tier coverage = which subset of [min, max] is covered by any tier
 *   - Warnings shown for: gaps in coverage, scores above max tier, scores below min tier
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

  const questions = ((quiz.questions ?? []) as Question[])
    .map((q) => ({ ...q, options: (q.options ?? []) as QuestionOption[] }))
    .sort((a, b) => a.order_index - b.order_index);

  const tiers = ((quiz.result_tiers ?? []) as Tier[]).sort(
    (a, b) => a.min_score - b.min_score,
  );

  const coverage = analyzeCoverage(questions, tiers);
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
          <div className="flex-shrink-0">
            <StatusControl quizId={quiz.id} currentStatus={status} />
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

      {/* Coverage analysis */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-foreground">Score coverage</h2>
        <p className="mt-2 text-sm text-muted">
          The achievable score range, and how well your result tiers cover it.
        </p>

        <div className="mt-4 rounded-lg border border-border bg-background p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Fact label="Min possible score" value={coverage.minPossible.toString()} />
            <Fact label="Max possible score" value={coverage.maxPossible.toString()} />
            <Fact
              label="Coverage"
              value={coverage.fullyCovered ? "Complete" : "Has gaps"}
              accent={coverage.fullyCovered ? "good" : "warn"}
            />
          </div>

          {coverage.warnings.length > 0 && (
            <ul className="mt-5 space-y-2">
              {coverage.warnings.map((w, idx) => (
                <li
                  key={idx}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  <span className="font-semibold">Note:</span> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Questions */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-foreground">Questions ({questions.length})</h2>
        {questions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No questions configured.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {questions.map((q) => (
              <li key={q.id} className="rounded-lg border border-border bg-background p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted">
                      Question {q.order_index} · weight {q.weight}
                    </p>
                    <p className="mt-1.5 text-base font-semibold text-foreground">
                      {q.prompt}
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {q.options.map((opt, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded-md bg-border/15 px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{opt.label}</span>
                      <span className="flex-shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        {opt.points} pt{opt.points === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Tiers */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-foreground">Result tiers ({tiers.length})</h2>
        {tiers.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No result tiers configured.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {tiers.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-background p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted">
                      Scores {t.min_score}–{t.max_score}
                    </p>
                    <p className="mt-1.5 text-base font-semibold text-foreground">
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>
                {t.cta_label && t.cta_url && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span className="text-muted">CTA:</span>
                    <a
                      href={t.cta_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline"
                    >
                      {t.cta_label} ↗
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-dashed border-border bg-background p-6">
        <h3 className="text-base font-semibold text-foreground">Editing</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Edit questions, options, and tiers via SQL until the quiz builder ships in
          piece 2.4. The status control on this page is fully functional today.
        </p>
      </section>
    </AdminShell>
  );
}

// =========================================================================
// Coverage analysis
// =========================================================================

type CoverageReport = {
  minPossible: number;
  maxPossible: number;
  fullyCovered: boolean;
  warnings: string[];
};

function analyzeCoverage(questions: Question[], tiers: Tier[]): CoverageReport {
  if (questions.length === 0) {
    return {
      minPossible: 0,
      maxPossible: 0,
      fullyCovered: tiers.length > 0,
      warnings:
        tiers.length === 0
          ? ["No questions and no tiers yet. Add both before publishing."]
          : ["No questions yet. Tiers will never be matched."],
    };
  }

  let minPossible = 0;
  let maxPossible = 0;
  for (const q of questions) {
    if (q.options.length === 0) {
      // Option-less question — treat as 0 contribution to both bounds.
      continue;
    }
    const points = q.options.map((o) => o.points * (q.weight ?? 1));
    minPossible += Math.min(...points);
    maxPossible += Math.max(...points);
  }

  const warnings: string[] = [];

  if (tiers.length === 0) {
    warnings.push(
      `Achievable scores are ${minPossible}–${maxPossible}, but no tiers are defined. All takers will see the generic "no tier" fallback.`,
    );
    return { minPossible, maxPossible, fullyCovered: false, warnings };
  }

  // Walk through the score range from minPossible to maxPossible and flag
  // any integer score that isn't covered by some tier.
  const uncovered: number[] = [];
  for (let s = minPossible; s <= maxPossible; s++) {
    const covered = tiers.some((t) => s >= t.min_score && s <= t.max_score);
    if (!covered) uncovered.push(s);
  }

  if (uncovered.length > 0) {
    warnings.push(
      uncovered.length <= 10
        ? `Scores ${uncovered.join(", ")} fall outside any tier — takers landing there will see a generic fallback.`
        : `${uncovered.length} possible scores (e.g. ${uncovered.slice(0, 5).join(", ")}...) fall outside any tier.`,
    );
  }

  // Check for tiers entirely outside the achievable range.
  for (const t of tiers) {
    if (t.max_score < minPossible) {
      warnings.push(
        `Tier "${t.title}" (${t.min_score}–${t.max_score}) is below the achievable minimum score of ${minPossible} — it can never match.`,
      );
    }
    if (t.min_score > maxPossible) {
      warnings.push(
        `Tier "${t.title}" (${t.min_score}–${t.max_score}) is above the achievable maximum score of ${maxPossible} — it can never match.`,
      );
    }
  }

  // Check for overlapping tiers — ambiguous which one wins (first found wins).
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i];
      const b = tiers[j];
      if (a.min_score <= b.max_score && b.min_score <= a.max_score) {
        warnings.push(
          `Tiers "${a.title}" and "${b.title}" overlap — scores in the overlap get the first-matched tier.`,
        );
      }
    }
  }

  return {
    minPossible,
    maxPossible,
    fullyCovered: uncovered.length === 0 && warnings.length === 0,
    warnings,
  };
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "warn";
}) {
  const valueClass =
    accent === "good"
      ? "text-brand"
      : accent === "warn"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-1.5 text-lg font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
