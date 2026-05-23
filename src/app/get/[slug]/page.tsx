import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { brand } from "@/lib/brand";
import { DirectDownloadGate } from "./DirectDownloadGate";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ slug: string }>;

/**
 * Public document download gate at /get/[slug].
 *
 * Shows the document title, description, and an email capture form.
 * On submit → captureDirectLead → redirect to /get/[slug]/download?s=<lead_id>&d=<doc_id>
 *
 * Works completely independently of the quiz funnel — usable from
 * cyrvana.com, LinkedIn, email campaigns, anywhere.
 */
export default async function DirectDownloadPage({
  params,
}: {
  params: RouteParams;
}) {
  const { slug } = await params;
  const supabase = createServiceRoleClient();

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, title, slug, description, access_level, is_direct_accessible, is_active")
    .eq("slug", slug)
    .eq("workspace_id", "00000000-0000-0000-0000-000000000001")
    .single();

  if (error || !doc || !doc.is_active || !doc.is_direct_accessible) {
    notFound();
  }

  // Public documents skip the gate entirely. The download button points at
  // the branded proxy route (/download/[slug]), which logs the event and
  // redirects to the file — one click, no email, no lead, no intermediate page.
  const isPublic = doc.access_level === "public";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-prose px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-8">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-brand">
            {brand.name} · Free resource
          </p>
          <h1 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {doc.title}
          </h1>
          {doc.description && (
            <p className="mt-4 text-base leading-relaxed text-muted">
              {doc.description}
            </p>
          )}
        </header>

        <div className="rounded-lg border border-border bg-background p-6 sm:p-8">
          {isPublic ? (
            <div>
              <p className="mb-4 text-sm text-muted">
                This resource is free to download — no email required.
              </p>
              <a
                href={`/download/${doc.slug}`}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600"
              >
                Download now
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          ) : (
            <>
              <p className="mb-6 text-sm text-muted">
                Enter your email to get immediate access to this resource.
              </p>
              <DirectDownloadGate
                documentId={doc.id}
                documentSlug={doc.slug}
                documentTitle={doc.title}
                documentDescription={doc.description}
              />
            </>
          )}
        </div>

        <footer className="mt-10 text-center text-xs text-muted">
          {brand.websiteUrl && (
            <a href={brand.websiteUrl} className="hover:text-foreground">
              {brand.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
        </footer>
      </div>
    </main>
  );
}
