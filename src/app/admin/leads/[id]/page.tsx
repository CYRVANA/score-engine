import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ id: string }>;

/**
 * Single-lead detail at /admin/leads/[id].
 *
 * Shows everything we have on a lead: contact info, quiz + tier + score,
 * the full answer breakdown, capture metadata (IP, consent, user agent).
 *
 * Useful for sales conversations and for auditing specific captures.
 */
export default async function LeadDetailPage({ params }: { params: RouteParams }) {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();
  const { id } = await params;

  type AnswerForDetail = {
    points: number;
    value: { option_index: number; option_label: string } | null;
    questions:
      | { prompt: string; order_index: number }
      | { prompt: string; order_index: number }[]
      | null;
  };

  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      `
      id,
      email,
      name,
      phone,
      captured_at,
      custom_fields,
      workspace_id,
      quizzes:quiz_id (
        id,
        title,
        slug
      ),
      sessions:session_id (
        id,
        score,
        started_at,
        completed_at,
        metadata,
        result_tiers:result_tier_id (
          title,
          description
        ),
        answers (
          points,
          value,
          questions:question_id (
            prompt,
            order_index
          )
        )
      )
    `,
    )
    .eq("id", id)
    .eq("workspace_id", profile.workspace_id)
    .single();

  if (error || !lead) {
    notFound();
  }

  const quiz = Array.isArray(lead.quizzes) ? lead.quizzes[0] : lead.quizzes;
  const session = Array.isArray(lead.sessions) ? lead.sessions[0] : lead.sessions;
  const tier = session
    ? Array.isArray(session.result_tiers)
      ? session.result_tiers[0]
      : session.result_tiers
    : null;

  const customFields = (lead.custom_fields ?? {}) as Record<string, unknown>;
  const sessionMetadata = ((session?.metadata ?? {}) as Record<string, unknown>) ?? {};

  const sortedAnswers = session?.answers
    ? ((session.answers as AnswerForDetail[])
        .map((a) => ({
          points: a.points,
          value: a.value,
          question: Array.isArray(a.questions) ? a.questions[0] : a.questions,
        }))
        .filter((a) => a.question !== null && a.question !== undefined)
        .sort(
          (a, b) => (a.question!.order_index ?? 0) - (b.question!.order_index ?? 0),
        ))
    : [];

  return (
    <AdminShell profile={profile}>
      <Link
        href="/admin/leads"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to leads
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">Lead</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          {lead.email}
        </h1>
        {lead.name && <p className="mt-2 text-lg text-muted">{lead.name}</p>}
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        {/* Result summary */}
        <div className="rounded-lg border border-border bg-navy-deep p-6 text-white lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-widest text-brand">
            Result
          </p>
          {tier ? (
            <>
              <h2 className="mt-2 text-2xl font-bold">{tier.title}</h2>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-brand">{session?.score}</span>
                <span className="text-base text-white/60">points</span>
              </div>
              {tier.description && (
                <p className="mt-4 text-sm leading-relaxed text-white/80">
                  {tier.description}
                </p>
              )}
            </>
          ) : (
            <>
              <h2 className="mt-2 text-2xl font-bold">Score: {session?.score ?? "—"}</h2>
              <p className="mt-2 text-sm text-white/70">No tier configured.</p>
            </>
          )}
        </div>

        {/* Quiz + capture metadata */}
        <div className="space-y-4">
          <InfoCard label="Quiz" value={quiz?.title ?? "—"} />
          <InfoCard label="Captured" value={formatDate(lead.captured_at)} />
          <InfoCard
            label="Quiz started"
            value={session?.started_at ? formatDate(session.started_at) : "—"}
          />
          <InfoCard
            label="Quiz completed"
            value={session?.completed_at ? formatDate(session.completed_at) : "—"}
          />
        </div>
      </section>

      {/* Answers */}
      {sortedAnswers.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-foreground">Answers</h2>
          <ol className="mt-4 space-y-3">
            {sortedAnswers.map((answer, idx) => (
              <li key={idx} className="rounded-lg border border-border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-widest text-muted">
                  Question {idx + 1}
                </p>
                <p className="mt-1.5 text-base font-semibold text-foreground">
                  {answer.question?.prompt}
                </p>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <p className="text-sm text-muted">
                    {answer.value?.option_label ?? "(no selection)"}
                  </p>
                  <span className="flex-shrink-0 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                    {answer.points} pt{answer.points === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Raw metadata (for audit and debugging) */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-foreground">Metadata</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MetadataRow label="Lead ID" value={lead.id} mono />
          <MetadataRow label="Session ID" value={session?.id ?? "—"} mono />
          <MetadataRow
            label="Client IP"
            value={typeof customFields.client_ip === "string" ? customFields.client_ip : "—"}
          />
          <MetadataRow
            label="Consent at"
            value={
              typeof customFields.consent_at === "string"
                ? formatDate(customFields.consent_at)
                : "—"
            }
          />
          <MetadataRow
            label="User agent"
            value={
              typeof sessionMetadata.user_agent === "string"
                ? sessionMetadata.user_agent
                : "—"
            }
          />
          <MetadataRow
            label="Referer"
            value={
              typeof sessionMetadata.referer === "string" ? sessionMetadata.referer : "—"
            }
          />
        </div>
      </section>
    </AdminShell>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function MetadataRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`mt-1 break-all text-sm text-foreground ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
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
