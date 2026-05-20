import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { isAiNarrativesEnabled } from "@/lib/feature-flags";
import { PromptEditor } from "./PromptEditor";
import { activatePromptTemplate } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Prompts admin at /admin/prompts.
 *
 * Lists every prompt template ever saved in the workspace, marks the active
 * one, and renders the editor pre-filled with the active template's content.
 * Saving always creates a NEW row (preserves version history) and optionally
 * activates the new version.
 *
 * Gated by FEATURE_AI_NARRATIVES. Returns 404 if disabled.
 */
export default async function PromptsPage() {
  if (!isAiNarrativesEnabled()) notFound();

  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: templates } = await supabase
    .from("prompt_templates")
    .select("id, name, model, is_active, created_at, body")
    .eq("workspace_id", profile.workspace_id)
    .order("created_at", { ascending: false });

  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, title")
    .eq("workspace_id", profile.workspace_id)
    .neq("status", "archived")
    .order("title");

  // The currently active template is the source for the editor's initial state.
  // Falls back to the most recent one if none are active.
  const activeTemplate =
    templates?.find((t) => t.is_active) ?? templates?.[0] ?? null;

  const initialName = activeTemplate ? `${activeTemplate.name} (revision)` : "Initial prompt";
  const initialBody = activeTemplate?.body ?? "";
  const initialModel = activeTemplate?.model ?? "claude-sonnet-4-6";

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand">
              AI prompts
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
              Narrative prompts
            </h1>
            <p className="mt-3 text-base text-muted">
              The active prompt is used to generate personalized narratives for
              every quiz taker. Saving always creates a new version — old prompts
              are preserved so you can roll back or reference them.
            </p>
          </div>
        </div>
      </header>

      {/* Editor */}
      <section className="mb-12 rounded-lg border border-border bg-background p-6 sm:p-8">
        <h2 className="mb-1 text-lg font-bold text-foreground">
          {activeTemplate ? "Edit prompt" : "Create your first prompt"}
        </h2>
        <p className="mb-6 text-sm text-muted">
          {activeTemplate
            ? `Currently active: ${activeTemplate.name}`
            : "No prompts yet. Set up your first."}
        </p>
        <PromptEditor
          initialName={initialName}
          initialBody={initialBody}
          initialModel={initialModel}
          quizzes={quizzes ?? []}
        />
      </section>

      {/* Version history */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-foreground">Version history</h2>
        {!templates || templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center">
            <p className="text-sm text-muted">No saved prompts yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-border/30">
                <tr>
                  <Th>Name</Th>
                  <Th>Model</Th>
                  <Th>Created</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {templates.map((t) => (
                  <tr key={t.id} className="align-middle">
                    <Td>
                      <span className="text-sm font-semibold text-foreground">
                        {t.name}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-muted">{t.model}</span>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {formatDate(t.created_at)}
                      </span>
                    </Td>
                    <Td>
                      {t.is_active ? (
                        <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-border/40 px-2.5 py-0.5 text-xs font-semibold text-muted">
                          Inactive
                        </span>
                      )}
                    </Td>
                    <Td>
                      {!t.is_active && (
                        <form action={activateFormAction}>
                          <input type="hidden" name="template_id" value={t.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-brand/30 bg-background px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
                          >
                            Activate
                          </button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">How this works</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          When a quiz taker submits the email gate, an AI narrative is enqueued for
          generation. A background worker drains the queue every minute, calls the
          configured model with the active prompt template (with placeholders filled
          in from the session), and saves the result. The taker&apos;s results page
          polls for the narrative and renders it once ready — typically 5-15 seconds
          after capture.
        </p>
        <p className="mt-3 text-sm text-muted">
          <Link href="/admin/leads" className="text-brand hover:underline">
            View leads
          </Link>{" "}
          to see the narratives generated for specific captures.
        </p>
      </section>
    </AdminShell>
  );
}

// FormData wrapper around activatePromptTemplate so we can use it as a form action.
async function activateFormAction(formData: FormData) {
  "use server";
  const templateId = String(formData.get("template_id") ?? "");
  if (templateId) await activatePromptTemplate(templateId);
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
