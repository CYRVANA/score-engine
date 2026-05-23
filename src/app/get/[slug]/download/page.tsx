import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ slug: string }>;
type SearchParams = Promise<{ s?: string; d?: string }>;

/**
 * Download page at /get/[slug]/download?s=<lead_id>&d=<doc_id>
 *
 * Server-side access verification + signed URL generation.
 * The actual Supabase Storage path is never exposed to the browser —
 * only the time-limited signed URL is rendered.
 *
 * For public documents: ?d=<doc_id> is enough, no lead required.
 * For gated documents: both ?s=<lead_id>&d=<doc_id> are required.
 */
export default async function DownloadPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { s: leadId, d: documentId } = await searchParams;
  const supabase = createServiceRoleClient();

  // Load the document.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, title, slug, description, access_level, is_active")
    .eq("slug", slug)
    .eq("workspace_id", "00000000-0000-0000-0000-000000000001")
    .single();

  if (docErr || !doc || !doc.is_active) notFound();

  // Build the download URL pointing at the branded proxy route.
  // The proxy verifies access, logs the event, and redirects to the file.
  let downloadUrl: string | null = null;
  let accessError: string | null = null;

  if (doc.access_level === "public") {
    // Public: proxy needs no lead id.
    downloadUrl = `/download/${doc.slug}`;
  } else {
    // Gated: verify the lead has an access grant before showing the button.
    if (!leadId || !documentId) {
      accessError = "Missing access credentials. Please go back and submit the form.";
    } else if (documentId !== doc.id) {
      notFound();
    } else {
      const { data: access, error: accessErr } = await supabase
        .from("document_access")
        .select("id, expires_at")
        .eq("lead_id", leadId)
        .eq("document_id", doc.id)
        .maybeSingle();

      if (accessErr || !access) {
        accessError = "We couldn't verify your access. Please try downloading again.";
      } else if (access.expires_at && new Date(access.expires_at) < new Date()) {
        accessError = "Your access link has expired. Please submit the form again.";
      } else {
        // Proxy URL with the lead id — proxy re-verifies + logs + redirects.
        downloadUrl = `/download/${doc.slug}?s=${leadId}`;
      }
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-prose px-6 py-12 sm:py-16">
        <header className="mb-8">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-brand">
            {brand.name} · Download
          </p>
          <h1 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {doc.title}
          </h1>
        </header>

        <div className="rounded-lg border border-border bg-background p-6 sm:p-8">
          {accessError ? (
            <div className="space-y-4">
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {accessError}
              </div>
              <Link
                href={`/get/${slug}`}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                ← Try again
              </Link>
            </div>
          ) : downloadUrl ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Your download is ready. Click the button below — the link is active
                for 24 hours.
              </p>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600"
              >
                Download {doc.title}
                <span aria-hidden="true">↓</span>
              </a>
              {doc.description && (
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  {doc.description}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted">Preparing your download...</div>
          )}
        </div>

        <footer className="mt-10 text-center">
          <Link href="/" className="text-xs text-muted hover:text-foreground">
            ← Back to {brand.name}
          </Link>
        </footer>
      </div>
    </main>
  );
}
