import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "@/components/AdminShell";
import { TierDistributionChart } from "@/components/charts/TierDistributionChart";
import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
import { QuizPicker } from "./QuizPicker";
import {
  listQuizzesForAnalytics,
  pickDefaultQuiz,
  computeAnalytics,
  computeDocumentDownloads,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ quiz?: string }>;

/**
 * Funnel analytics at /admin/analytics.
 *
 * Phase 2.6: 30-day lookback per quiz. Headline stats, score distribution
 * bucketed by tier, daily lead capture trend, recent leads.
 *
 * Quiz selection via URL param ?quiz=<id>. Defaults to the most active quiz.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const profile = await requireAdmin();
  const sp = await searchParams;

  const quizzes = await listQuizzesForAnalytics(profile.workspace_id);

  if (quizzes.length === 0) {
    return (
      <AdminShell profile={profile}>
        <header className="mb-8">
          <p className="text-sm font-medium uppercase tracking-widest text-brand">
            Analytics
          </p>
          <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
            Funnel analytics
          </h1>
        </header>
        <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
          <p className="text-base font-semibold text-foreground">No quizzes yet.</p>
          <p className="mt-2 text-sm text-muted">
            Create a quiz first and capture some leads, then come back here.
          </p>
        </div>
      </AdminShell>
    );
  }

  // Resolve which quiz to show.
  const requestedQuizId = sp.quiz && quizzes.some((q) => q.id === sp.quiz) ? sp.quiz : null;
  const defaultQuizId = requestedQuizId ?? (await pickDefaultQuiz(profile.workspace_id));
  const activeQuizId = defaultQuizId ?? quizzes[0].id;
  const activeQuiz = quizzes.find((q) => q.id === activeQuizId) ?? quizzes[0];

  const report = await computeAnalytics(profile.workspace_id, activeQuiz.id);
  const downloads = await computeDocumentDownloads(profile.workspace_id, 30);

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Analytics
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              Funnel analytics
            </h1>
            <p className="mt-3 text-base text-muted">
              30-day rolling window. Live data from your sessions and leads.
            </p>
          </div>
        </div>
      </header>

      {/* Quiz picker */}
      <div className="mb-8">
        <label
          htmlFor="quiz-picker"
          className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted"
        >
          Quiz
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <QuizPicker quizzes={quizzes} currentQuizId={activeQuiz.id} />
          </div>
          <Link
            href={`/admin/quizzes/${activeQuiz.id}`}
            className="text-xs text-muted hover:text-foreground"
          >
            Edit quiz →
          </Link>
        </div>
      </div>

      {/* Headline stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Views" value={report.views} subtle="sessions started" />
        <StatCard
          label="Completions"
          value={report.completions}
          subtle="quiz finished"
        />
        <StatCard
          label="Lead captures"
          value={report.captures}
          subtle="email submitted"
        />
        <StatCard
          label="Completion rate"
          value={formatPercent(report.completion_rate)}
          subtle="completions ÷ views"
          accent
        />
        <StatCard
          label="Capture rate"
          value={formatPercent(report.capture_rate)}
          subtle="captures ÷ completions"
          accent
        />
        <StatCard
          label="Overall conversion"
          value={formatPercent(report.overall_conversion)}
          subtle="captures ÷ views"
          accent
        />
      </section>

      {/* Distribution and trend side-by-side on desktop, stacked on mobile */}
      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold text-foreground">Score distribution</h2>
          <p className="mb-4 text-sm text-muted">
            Where completed sessions land by tier.
          </p>
          <TierDistributionChart buckets={report.score_distribution} />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold text-foreground">Trend</h2>
          <p className="mb-4 text-sm text-muted">
            Daily lead captures over the lookback window.
          </p>
          <DailyTrendChart data={report.daily_captures} />
        </div>
      </section>

      {/* Recent leads */}
      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-foreground">Recent leads</h2>
          <Link
            href={`/admin/leads?quiz=${activeQuiz.id}`}
            className="text-xs text-muted hover:text-foreground"
          >
            See all leads →
          </Link>
        </div>

        {report.recent_leads.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background p-6 text-center">
            <p className="text-sm text-muted">
              No leads captured in the last 30 days.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-border/30">
                <tr>
                  <Th>Email</Th>
                  <Th>Captured</Th>
                  <Th>Score</Th>
                  <Th>Tier</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.recent_leads.map((lead) => (
                  <tr key={lead.id} className="transition hover:bg-border/20">
                    <Td>
                      <Link
                        href={`/admin/leads/${lead.id}`}
                        className="block text-sm font-medium text-foreground hover:text-brand"
                      >
                        {lead.email}
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {formatDate(lead.captured_at)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm font-semibold text-foreground">
                        {lead.score ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      {lead.tier_title ? (
                        <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                          {lead.tier_title}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ============ Document downloads (workspace-wide) ============ */}
      <section className="mt-12 border-t border-border pt-10">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-foreground">Document downloads</h2>
          <p className="mt-1 text-sm text-muted">
            Workspace-wide over the last {downloads.windowDays} days. Free downloads are
            anonymous (no lead captured); gated downloads are tied to a lead.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total downloads" value={downloads.totalDownloads} accent />
          <StatCard
            label="Free (anonymous)"
            value={downloads.totalAnonymous}
            subtle="no email captured"
          />
          <StatCard
            label="Gated (identified)"
            value={downloads.totalGated}
            subtle="lead captured"
          />
        </div>

        {downloads.byDocument.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border bg-background p-8 text-center">
            <p className="text-sm text-muted">
              No downloads yet in this window. Share a document link to get started.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* By document */}
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="border-b border-border bg-border/30 px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">By document</h3>
              </div>
              <table className="min-w-full divide-y divide-border">
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Total</Th>
                    <Th>Free</Th>
                    <Th>Gated</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {downloads.byDocument.map((d) => (
                    <tr key={d.document_id}>
                      <Td>
                        <span className="text-sm font-medium text-foreground">
                          {d.title}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm font-semibold text-foreground">
                          {d.total}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-muted">{d.anonymous}</span>
                      </Td>
                      <Td>
                        <span className="text-sm text-muted">{d.gated}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By source */}
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="border-b border-border bg-border/30 px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">By source</h3>
                <p className="mt-0.5 text-xs text-muted">
                  From UTM tags or referrer. Tag your share links with{" "}
                  <code className="rounded bg-border/40 px-1">?utm_source=…</code>
                </p>
              </div>
              <table className="min-w-full divide-y divide-border">
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th>Downloads</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {downloads.bySource.map((s) => (
                    <tr key={s.source}>
                      <Td>
                        <span className="text-sm font-medium text-foreground">
                          {s.source}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm font-semibold text-foreground">
                          {s.count}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function StatCard({
  label,
  value,
  subtle,
  accent,
}: {
  label: string;
  value: number | string;
  subtle?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold ${accent ? "text-brand" : "text-foreground"}`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {subtle && <p className="mt-1 text-xs text-muted">{subtle}</p>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
