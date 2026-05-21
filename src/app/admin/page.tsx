import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

/**
 * Admin home page at /admin.
 *
 * Phase 2.1: minimal — greeting + a few headline counts pulled from Supabase.
 * Each protected admin page calls requireAdmin() then wraps content in
 * AdminShell. We deliberately do NOT use a shared layout.tsx because the
 * login/logout routes need to OPT OUT of the shell, and excluding routes
 * from a layout is awkward in App Router.
 */
export default async function AdminHome() {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Headline counts, scoped to the admin's workspace.
  const [leadsResult, sessionsResult, quizzesResult] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id),
    // sessions doesn't have workspace_id directly; join through quizzes.
    supabase
      .from("sessions")
      .select("quizzes!inner(workspace_id)", { count: "exact", head: true })
      .eq("quizzes.workspace_id", profile.workspace_id),
    supabase
      .from("quizzes")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id),
  ]);

  const leadCount = leadsResult.count ?? 0;
  const sessionCount = sessionsResult.count ?? 0;
  const quizCount = quizzesResult.count ?? 0;

  // First-name greeting.
  const firstName = profile.email.split("@")[0].split(".")[0];
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <AdminShell profile={profile}>
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          Welcome back, {displayName}
        </h1>
        <p className="mt-3 text-base text-muted">
          Here&apos;s a quick look at your score-engine activity.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total leads" value={leadCount} />
        <StatCard label="Quiz attempts" value={sessionCount} />
        <StatCard label="Quizzes" value={quizCount} />
      </section>

      <section className="mt-12 rounded-lg border border-border bg-background p-6 sm:p-8">
        <h2 className="text-xl font-bold text-foreground">Quick links</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink href="/admin/leads" label="Leads" description="View and export captured leads" />
          <QuickLink href="/admin/quizzes" label="Quizzes" description="Build and manage assessments" />
          <QuickLink href="/admin/analytics" label="Analytics" description="Funnel metrics and trend data" />
          <QuickLink href="/admin/destinations" label="Destinations" description="HubSpot and webhook delivery" />
          <QuickLink href="/admin/prompts" label="AI Prompts" description="Edit the narrative prompt template" />
          <QuickLink href="https://assess.cyrvana.com/q/cyber-readiness" label="Take the assessment" description="See the live quiz as a prospect would" external />
        </div>
      </section>
    </AdminShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-6">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-2 text-4xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}

function QuickLink({
  href,
  label,
  description,
  external,
}: {
  href: string;
  label: string;
  description: string;
  external?: boolean;
}) {
  const props = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <a
      href={href}
      {...props}
      className="group rounded-md border border-border bg-background p-4 transition hover:border-brand/40 hover:bg-brand/5"
    >
      <p className="text-sm font-semibold text-foreground group-hover:text-brand">
        {label}
        {external && <span className="ml-1 text-xs text-muted">↗</span>}
      </p>
      <p className="mt-1 text-xs text-muted">{description}</p>
    </a>
  );
}
