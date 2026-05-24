import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/AdminShell";
import { brand } from "@/lib/brand";
import { DocumentUploadForm } from "./DocumentUploadForm";
import { DeleteDocumentButton } from "./DeleteDocumentButton";
import { setDocumentActive, deleteDocument } from "./actions";

export const dynamic = "force-dynamic";

const ACCESS_LABELS: Record<string, string> = {
  public: "Public",
  email_gated: "Email gated",
  paid: "Paid",
};

const ACCESS_BADGE: Record<string, string> = {
  public: "bg-brand/10 text-brand-700",
  email_gated: "bg-border/40 text-muted",
  paid: "bg-amber-100 text-amber-800",
};

export default async function DocumentsPage() {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: documents } = await supabase
    .from("documents")
    .select(
      `
      id, title, slug, description, access_level,
      is_direct_accessible, is_active, created_at,
      document_access (id)
    `,
    )
    .eq("workspace_id", profile.workspace_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <AdminShell profile={profile}>
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-brand">
          Documents
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground sm:text-4xl">
          Resource library
        </h1>
        <p className="mt-3 text-base text-muted">
          Upload PDFs and other resources. Attach them to result tiers for automatic
          delivery, or make them available as standalone downloads at{" "}
          <code className="rounded bg-border/40 px-1 text-sm">
            {brand.siteUrl}/get/[slug]
          </code>
          .
        </p>
      </header>

      {/* Upload form */}
      <section className="mb-10 rounded-lg border border-border bg-background p-6 sm:p-8">
        <h2 className="mb-6 text-lg font-bold text-foreground">Upload a document</h2>
        <DocumentUploadForm />
      </section>

      {/* Existing documents */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-foreground">All documents</h2>

        {!documents || documents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
            <p className="text-base font-semibold text-foreground">No documents yet.</p>
            <p className="mt-2 text-sm text-muted">Upload your first PDF above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-border/30">
                <tr>
                  <Th>Title</Th>
                  <Th>Slug / URL</Th>
                  <Th>Access</Th>
                  <Th>Direct</Th>
                  <Th className="text-right">Downloads</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((doc) => {
                  const downloadCount = Array.isArray(doc.document_access)
                    ? doc.document_access.length
                    : 0;
                  return (
                    <tr key={doc.id} className="align-middle">
                      <Td>
                        <p className="text-sm font-semibold text-foreground">
                          {doc.title}
                        </p>
                        {doc.description && (
                          <p className="mt-0.5 text-xs text-muted line-clamp-1">
                            {doc.description}
                          </p>
                        )}
                      </Td>
                      <Td>
                        {doc.is_direct_accessible ? (
                          <a
                            href={`/get/${doc.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-brand hover:underline"
                          >
                            /get/{doc.slug}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-muted">
                            /get/{doc.slug}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACCESS_BADGE[doc.access_level] ?? "bg-border/40 text-muted"}`}
                        >
                          {ACCESS_LABELS[doc.access_level] ?? doc.access_level}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-muted">
                          {doc.is_direct_accessible ? "Yes" : "No"}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <span className="text-sm font-semibold text-foreground">
                          {downloadCount}
                        </span>
                      </Td>
                      <Td>
                        {doc.is_active ? (
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
                        <div className="flex flex-wrap items-center gap-2">
                          <form
                            action={async () => {
                              "use server";
                              await setDocumentActive(doc.id, !doc.is_active);
                            }}
                          >
                            <button
                              type="submit"
                              className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground hover:bg-border/30"
                            >
                              {doc.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </form>

                          {downloadCount === 0 && (
                            <DeleteDocumentButton
                              title={doc.title}
                              onDelete={async () => {
                                "use server";
                                await deleteDocument(doc.id);
                              }}
                            />
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Attaching documents to quiz tiers</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          To auto-deliver a document when a prospect completes a quiz and lands in a tier,
          go to{" "}
          <Link href="/admin/quizzes" className="text-brand hover:underline">
            Quizzes
          </Link>
          , open your quiz, and use the document attachment section in each tier.
          Documents are granted automatically at lead capture — no manual steps needed.
        </p>
      </section>
    </AdminShell>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}
