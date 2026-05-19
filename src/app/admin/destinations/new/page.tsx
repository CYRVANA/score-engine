import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { NewDestinationForm } from "../NewDestinationForm";
import { isDestinationsEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function NewDestinationPage() {
  if (!isDestinationsEnabled()) notFound();

  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Quizzes used for the scope dropdown (workspace-wide or per-quiz).
  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, title")
    .eq("workspace_id", profile.workspace_id)
    .neq("status", "archived")
    .order("title");

  return (
    <AdminShell profile={profile}>
      <Link
        href="/admin/destinations"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Back to destinations
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">
          New destination
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          Add a destination
        </h1>
        <p className="mt-3 text-base text-muted">
          Configure where new leads should flow. You can test the connection before saving.
        </p>
      </header>

      <div className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8">
        <NewDestinationForm quizzes={quizzes ?? []} />
      </div>
    </AdminShell>
  );
}
