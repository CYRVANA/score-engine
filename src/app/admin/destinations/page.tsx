import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { isDestinationsEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  generic_webhook: "Webhook",
};

/**
 * Destinations list at /admin/destinations.
 *
 * Shows all configured destinations with per-destination delivery stats
 * for the last 30 days. Click a row → detail page with the recent delivery
 * log + edit/delete actions.
 *
 * Gated by FEATURE_DESTINATIONS env var. When disabled, returns 404 — the
 * route exists in code but is invisible to users.
 */
export default async function DestinationsPage() {
  if (!isDestinationsEnabled()) notFound();

  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: destinations, error } = await supabase
    .from("destinations")
    .select(
      `
      id, name, type, is_active, quiz_id, created_at,
      last_test_at, last_test_status,
      quizzes:quiz_id ( title, slug )
    `,
    )
    .eq("workspace_id", profile.workspace_id)
    .order("created_at", { ascending: false });

  // Per-destination 30-day stats (counts).
  const destIds = (destinations ?? []).map((d) => d.id);
  const stats: Record<string, { delivered: number; failed: number; pending: number }> = {};
  for (const id of destIds) {
    stats[id] = { delivered: 0, failed: 0, pending: 0 };
  }
  if (destIds.length > 0) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deliveries } = await supabase
      .from("destination_deliveries")
      .select("destination_id, status")
      .in("destination_id", destIds)
      .gte("created_at", thirtyDaysAgo);
    for (const dl of deliveries ?? []) {
      const s = stats[dl.destination_id];
      if (!s) continue;
      if (dl.status === "delivered") s.delivered += 1;
      else if (dl.status === "failed") s.failed += 1;
      else s.pending += 1; // pending, retrying, in_flight
    }
  }

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Destinations
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              Lead destinations
            </h1>
            <p className="mt-3 text-base text-muted">
              Configure where leads flow after capture. Currently supported: HubSpot
              and generic webhooks.
            </p>
          </div>
          <Link
            href="/admin/destinations/new"
            className="inline-flex items-center gap-1 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            <span aria-hidden="true">+</span> New destination
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load destinations: {error.message}
        </div>
      ) : !destinations || destinations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
          <p className="text-base font-semibold text-foreground">No destinations yet.</p>
          <p className="mt-2 text-sm text-muted">
            Add HubSpot or a webhook to start delivering leads automatically.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-border/30">
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Scope</Th>
                <Th>Status</Th>
                <Th className="text-right">Delivered (30d)</Th>
                <Th className="text-right">Failed (30d)</Th>
                <Th className="text-right">Pending</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {destinations.map((d) => {
                const quiz = Array.isArray(d.quizzes) ? d.quizzes[0] : d.quizzes;
                const s = stats[d.id] ?? { delivered: 0, failed: 0, pending: 0 };
                return (
                  <tr key={d.id} className="transition hover:bg-border/20">
                    <Td>
                      <Link
                        href={`/admin/destinations/${d.id}`}
                        className="block font-semibold text-foreground hover:text-brand"
                      >
                        {d.name}
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-sm text-muted">
                        {TYPE_LABELS[d.type] ?? d.type}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-muted">
                        {quiz ? quiz.title : "All quizzes"}
                      </span>
                    </Td>
                    <Td>
                      {d.is_active ? (
                        <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-border/40 px-2.5 py-0.5 text-xs font-semibold text-muted">
                          Inactive
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <span className="text-sm font-semibold text-foreground">
                        {s.delivered.toLocaleString()}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span
                        className={`text-sm font-semibold ${
                          s.failed > 0 ? "text-red-700" : "text-muted"
                        }`}
                      >
                        {s.failed.toLocaleString()}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <span className="text-sm font-semibold text-muted">
                        {s.pending.toLocaleString()}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-10 rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">How delivery works</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          When a lead is captured, score-engine enqueues a delivery to every active
          destination configured for that quiz (or workspace-wide). A background
          worker polls the queue every minute and calls each destination&apos;s API.
          Failed deliveries are retried with exponential backoff up to 6 times, then
          marked failed; you can retry them manually from the destination detail page.
        </p>
      </section>
    </AdminShell>
  );
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
