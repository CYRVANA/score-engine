import { getDocumentsForSession } from "./actions";

/**
 * Renders document download cards on the quiz results page.
 *
 * Placed below the tier card (and below the AI narrative if enabled).
 * Only renders if the lead has document access grants for their tier.
 */
export async function DocumentDownloads({
  sessionId,
  leadId,
}: {
  sessionId: string;
  leadId: string | null;
}) {
  if (!leadId) return null;

  const documents = await getDocumentsForSession(sessionId, leadId);
  if (!documents || documents.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-brand">
        Your resources
      </p>
      <div className="space-y-3">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{doc.title}</p>
              {doc.description && (
                <p className="mt-1 text-sm text-muted">{doc.description}</p>
              )}
            </div>
            <a
              href={doc.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-md border border-brand/30 bg-background px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10"
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
