import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { StatusControl } from "./StatusControl";

export const dynamic = "force-dynamic";

type QuizStatus = "draft" | "published" | "archived";

/**
 * Quizzes list at /admin/quizzes.
 *
 * Phase 2.3: list view with status controls. Per-row click opens detail.
 * Creating quizzes via UI lands in piece 2.4.
 */
export default async function QuizzesPage() {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Quizzes in this workspace.
  const { data: quizzes, error } = await supabase
    .from("quizzes")
    .select("id, slug, title, category, segment, status, created_at")
    .eq("workspace_id", profile.workspace_id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <AdminShell profile={profile}>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load quizzes: {error.message}
        </div>
      </AdminShell>
    );
  }

  // Per-quiz lead counts + last activity. One round-trip via group-by is
  // not exposed by PostgREST; for v1 we do a separate count per quiz.
  // Acceptable at small-enterprise scale (few quizzes); revisit if list grows.
  const quizIds = (quizzes ?? []).map((q) => q.id);
  const stats = await loadQuizStats(supabase, profile.workspace_id, quizIds);

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Quizzes
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              All quizzes
            </h1>
            <p className="mt-3 text-base text-muted">
              {quizzes?.length ?? 0} total in your workspace.
            </p>
          </div>
          <Link
            href="/admin/quizzes/new"
            className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            <span aria-hidden="true">+</span> New quiz
          </Link>
        </div>
      </header>

      {!quizzes || quizzes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
          <p className="text-base font-semibold text-foreground">No quizzes yet.</p>
          <p className="mt-2 text-sm text-muted">
            Click <span className="font-semibold text-foreground">+ New quiz</span> to
            create your first one.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-border/30">
              <tr>
                <Th>Title</Th>
                <Th>Slug</Th>
                <Th>Category</Th>
                <Th>Segment</Th>
                <Th>Status</Th>
                <Th className="text-right">Leads</Th>
                <Th>Last activity</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quizzes.map((q) => {
                const stat = stats[q.id] ?? { leadCount: 0, lastActivity: null };
                const status = (q.status as QuizStatus) ?? "draft";
                return (
                  <tr key={q.id} className="transition hover:bg-border/20">
                    <Td>
                      <Link
                        href={`/admin/quizzes/${q.id}`}
                        className="block font-semibold text-foreground hover:text-brand"
                      >
                        {q.title}
                      </Link>
                    </Td>
                    <Td>
                      {status === "published" ? (
                        <a
                          href={`/q/${q.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-brand"
                          title="Open public URL in new tab"
                        >
                          /q/{q.slug}
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-muted">/q/{q.slug}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-sm text-muted">{q.category ?? "—"}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-muted">{q.segment ?? "—"}</span>
                    </Td>
                    <Td>
                      <StatusControl quizId={q.id} currentStatus={status} />
                    </Td>
                    <Td className="text-right">
                      <span className="text-sm font-semibold text-foreground">
                        {stat.leadCount.toLocaleString()}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {stat.lastActivity ? formatDate(stat.lastActivity) : "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">{formatDate(q.created_at)}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

type QuizStats = { leadCount: number; lastActivity: string | null };

async function loadQuizStats(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  quizIds: string[],
): Promise<Record<string, QuizStats>> {
  if (quizIds.length === 0) return {};

  // Pull all leads' (quiz_id, captured_at) for this workspace in one query.
  // At small-enterprise scale this is fast even with thousands of leads.
  const { data: leads } = await supabase
    .from("leads")
    .select("quiz_id, captured_at")
    .eq("workspace_id", workspaceId)
    .in("quiz_id", quizIds);

  const stats: Record<string, QuizStats> = {};
  for (const id of quizIds) {
    stats[id] = { leadCount: 0, lastActivity: null };
  }
  for (const lead of leads ?? []) {
    const s = stats[lead.quiz_id];
    if (!s) continue;
    s.leadCount += 1;
    if (!s.lastActivity || lead.captured_at > s.lastActivity) {
      s.lastActivity = lead.captured_at;
    }
  }
  return stats;
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>;
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
