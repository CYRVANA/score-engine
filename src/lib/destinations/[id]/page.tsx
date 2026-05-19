import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import {
  DestinationToggleActive,
  DestinationDeleteButton,
  RetryDeliveryButton,
} from "../DestinationActions";
import { isDestinationsEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

const TYPE_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  generic_webhook: "Webhook",
};

const STATUS_BADGE: Record<string, string> = {
  delivered: "bg-brand/10 text-brand-700",
  pending: "bg-border/40 text-muted",
  retrying: "bg-amber-100 text-amber-800",
  in_flight: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

/**
 * Destination detail at /admin/destinations/[id].
 *
 * Shows config (redacted), active/inactive toggle, delete button, and a
 * paginated table of the most recent 50 delivery attempts with retry on failures.
 */
export default async function DestinationDetailPage({
  params,
}: {
  params: RouteParams;
}) {
  if (!isDestinationsEnabled()) notFound();

  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const { id } = await params;

  const { data: dest, error } = await supabase
    .from("destinations")
    .select(
      `
      id, name, type, is_active, quiz_id, created_at,
      last_test_at, last_test_status, last_test_error,
      quizzes:quiz_id ( title, slug )
    `,
    )
    .eq("id", id)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (error || !dest) notFound();

  const quiz = Array.isArray(dest.quizzes) ? dest.quizzes[0] : dest.quizzes;

  // Recent delivery history.
  const { data: deliveries } = await supabase
    .from("destination_deliveries")
    .select(
      `
      id, status, attempt_count, created_at, delivered_at, last_attempt_at,
      next_attempt_at, last_error, external_id, lead_id,
      leads:lead_id ( email, name )
    `,
    )
    .eq("destination_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AdminShell profile={profile}>
      <Link
        href="/admin/destinations"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to destinations
      </Link>

      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              Destination
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              {dest.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted">{TYPE_LABELS[dest.type] ?? dest.type}</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{quiz ? quiz.title : "All quizzes"}</span>
              {dest.is_active ? (
                <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  Active
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-border/40 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  Inactive
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-start gap-2">
            <DestinationToggleActive destId={dest.id} isActive={dest.is_active} />
            <DestinationDeleteButton destId={dest.id} />
          </div>
        </div>
      </header>

      {/* Recent deliveries */}
      <section>
        <h2 className="text-xl font-bold text-foreground">Recent deliveries</h2>
        <p className="mt-2 text-sm text-muted">Last 50 delivery attempts.</p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-background">
          {!deliveries || deliveries.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-base font-semibold text-foreground">No deliveries yet.</p>
              <p className="mt-2 text-sm text-muted">
                Once leads are captured on a quiz this destination handles, deliveries
                will appear here within a minute.
              </p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-border/30">
                <tr>
                  <Th>When</Th>
                  <Th>Lead</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Detail</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.map((d) => {
                  const lead = Array.isArray(d.leads) ? d.leads[0] : d.leads;
                  const badge = STATUS_BADGE[d.status] ?? "bg-border/40 text-muted";
                  return (
                    <tr key={d.id} className="align-top">
                      <Td>
                        <span className="text-xs text-muted">{formatDate(d.created_at)}</span>
                      </Td>
                      <Td>
                        {lead ? (
                          <Link
                            href={`/admin/leads/${d.lead_id}`}
                            className="block text-sm font-medium text-foreground hover:text-brand"
                          >
                            {lead.email}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted">(deleted lead)</span>
                        )}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}
                        >
                          {d.status}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-foreground">{d.attempt_count}</span>
                      </Td>
                      <Td>
                        {d.status === "delivered" && d.external_id ? (
                          <span className="font-mono text-xs text-muted">
                            external_id: {d.external_id}
                          </span>
                        ) : d.last_error ? (
                          <span className="text-xs text-red-700">
                            {d.last_error.length > 100
                              ? d.last_error.slice(0, 100) + "…"
                              : d.last_error}
                          </span>
                        ) : d.status === "retrying" ? (
                          <span className="text-xs text-muted">
                            Next try {formatDate(d.next_attempt_at)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Td>
                      <Td>
                        {d.status === "failed" ? (
                          <RetryDeliveryButton deliveryId={d.id} />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
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
  return <td className="px-4 py-3">{children}</td>;
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
