import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { LeadsFilters } from "./LeadsFilters";
import { ExportButton } from "./ExportButton";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  quiz?: string;
  q?: string;
  page?: string;
}>;

/**
 * Leads viewer at /admin/leads.
 *
 * URL state drives the table:
 *   ?quiz=<quiz_id>   — filter to a specific quiz (or "all" / omitted = all)
 *   ?q=<substring>    — case-insensitive substring match against email
 *   ?page=<n>         — 1-based page index, 25 per page
 *
 * URL state lets the back button work as expected and makes filtered views
 * shareable / bookmarkable.
 */
export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  const selectedQuizId = sp.quiz && sp.quiz !== "all" ? sp.quiz : null;
  const searchQuery = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Quizzes list for the filter dropdown.
  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, title, slug")
    .eq("workspace_id", profile.workspace_id)
    .order("title");

  // Leads query — apply filters, paginate.
  let leadsQuery = supabase
    .from("leads")
    .select(
      `
      id,
      email,
      name,
      captured_at,
      quiz_id,
      session_id,
      quizzes:quiz_id ( title ),
      sessions:session_id ( score, result_tiers:result_tier_id ( title ) )
    `,
      { count: "exact" },
    )
    .eq("workspace_id", profile.workspace_id)
    .order("captured_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (selectedQuizId) {
    leadsQuery = leadsQuery.eq("quiz_id", selectedQuizId);
  }
  if (searchQuery) {
    // Case-insensitive substring match on email.
    leadsQuery = leadsQuery.ilike("email", `%${searchQuery}%`);
  }

  const { data: leads, error, count } = await leadsQuery;
  const totalLeads = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalLeads / PAGE_SIZE));

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Leads
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              Captured leads
            </h1>
            <p className="mt-3 text-base text-muted">
              {totalLeads.toLocaleString()} total
              {selectedQuizId || searchQuery ? " matching the current filter" : ""}.
            </p>
          </div>
          <ExportButton
            quizId={selectedQuizId}
            searchQuery={searchQuery}
            disabled={totalLeads === 0}
          />
        </div>
      </header>

      <LeadsFilters
        quizzes={quizzes ?? []}
        currentQuizId={selectedQuizId}
        currentSearch={searchQuery}
      />

      {error ? (
        <div className="mt-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load leads: {error.message}
        </div>
      ) : !leads || leads.length === 0 ? (
        <EmptyState hasFilter={!!selectedQuizId || !!searchQuery} />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-background">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-border/30">
                <tr>
                  <Th>Captured</Th>
                  <Th>Email</Th>
                  <Th>Name</Th>
                  <Th>Quiz</Th>
                  <Th>Score</Th>
                  <Th>Tier</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => {
                  // Defensive embed unwrapping (array-or-object widening).
                  const quiz = Array.isArray(lead.quizzes) ? lead.quizzes[0] : lead.quizzes;
                  const session = Array.isArray(lead.sessions)
                    ? lead.sessions[0]
                    : lead.sessions;
                  const tier = session
                    ? Array.isArray(session.result_tiers)
                      ? session.result_tiers[0]
                      : session.result_tiers
                    : null;

                  return (
                    <tr
                      key={lead.id}
                      className="cursor-pointer transition hover:bg-border/20"
                    >
                      <Td>
                        <Link
                          href={`/admin/leads/${lead.id}`}
                          className="block text-xs text-muted hover:text-foreground"
                        >
                          {formatDate(lead.captured_at)}
                        </Link>
                      </Td>
                      <Td>
                        <Link
                          href={`/admin/leads/${lead.id}`}
                          className="block font-medium text-foreground hover:text-brand"
                        >
                          {lead.email}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-sm text-foreground">{lead.name ?? "—"}</span>
                      </Td>
                      <Td>
                        <span className="text-sm text-muted">{quiz?.title ?? "—"}</span>
                      </Td>
                      <Td>
                        <span className="text-sm font-semibold text-foreground">
                          {session?.score ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        {tier ? (
                          <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                            {tier.title}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalLeads={totalLeads}
            pageSize={PAGE_SIZE}
            searchParams={sp}
          />
        </>
      )}
    </AdminShell>
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

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="mt-10 rounded-lg border border-dashed border-border bg-background p-10 text-center">
      <p className="text-base font-semibold text-foreground">
        {hasFilter ? "No leads match the current filter." : "No leads yet."}
      </p>
      <p className="mt-2 text-sm text-muted">
        {hasFilter
          ? "Try clearing the filter or adjusting the search."
          : "Once people complete a published quiz and submit the email gate, they show up here."}
      </p>
    </div>
  );
}

function Pagination({
  currentPage,
  totalPages,
  totalLeads,
  pageSize,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  totalLeads: number;
  pageSize: number;
  searchParams: { quiz?: string; q?: string; page?: string };
}) {
  if (totalPages <= 1) return null;

  // Preserve filter/search params across page navigations.
  const baseParams = new URLSearchParams();
  if (searchParams.quiz) baseParams.set("quiz", searchParams.quiz);
  if (searchParams.q) baseParams.set("q", searchParams.q);

  const buildHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(p));
    return `/admin/leads?${params.toString()}`;
  };

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalLeads);

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted">
        Showing <span className="font-semibold text-foreground">{from}</span>–
        <span className="font-semibold text-foreground">{to}</span> of{" "}
        <span className="font-semibold text-foreground">{totalLeads.toLocaleString()}</span>
      </p>
      <div className="flex gap-2">
        {currentPage > 1 ? (
          <Link
            href={buildHref(currentPage - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-border/30"
          >
            ← Previous
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-muted opacity-50">
            ← Previous
          </span>
        )}
        {currentPage < totalPages ? (
          <Link
            href={buildHref(currentPage + 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-border/30"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-muted opacity-50">
            Next →
          </span>
        )}
      </div>
    </nav>
  );
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
