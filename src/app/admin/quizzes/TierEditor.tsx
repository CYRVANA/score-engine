"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTier, deleteTier, type TierInput } from "./actions";
import { attachDocumentToTier, detachDocumentFromTier } from "../documents/actions";

export type AvailableDocument = {
  id: string;
  title: string;
  access_level: string;
};

export type TierForEdit = {
  id: string;
  min_score: number;
  max_score: number;
  title: string;
  description: string | null;
  cta_label: string | null;
  cta_url: string | null;
  attached_document_ids: string[];
};

type EditState = {
  min_score: number;
  max_score: number;
  title: string;
  description: string;
  cta_label: string;
  cta_url: string;
};

function toEditState(t: TierForEdit): EditState {
  return {
    min_score: t.min_score,
    max_score: t.max_score,
    title: t.title,
    description: t.description ?? "",
    cta_label: t.cta_label ?? "",
    cta_url: t.cta_url ?? "",
  };
}

function isDirty(orig: TierForEdit, draft: EditState): boolean {
  return (
    orig.min_score !== draft.min_score ||
    orig.max_score !== draft.max_score ||
    orig.title !== draft.title ||
    (orig.description ?? "") !== draft.description ||
    (orig.cta_label ?? "") !== draft.cta_label ||
    (orig.cta_url ?? "") !== draft.cta_url
  );
}

export function TierEditor({
  quizId,
  tier,
  availableDocuments,
  onLocalChange,
}: {
  quizId: string;
  tier: TierForEdit;
  availableDocuments: AvailableDocument[];
  onLocalChange: (
    tid: string,
    range: { min_score: number; max_score: number; title: string },
  ) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditState>(toEditState(tier));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [docPending, startDocTransition] = useTransition();

  // Local view of which documents are attached, for optimistic toggling.
  const [attachedIds, setAttachedIds] = useState<string[]>(
    tier.attached_document_ids ?? [],
  );

  const dirty = isDirty(tier, draft);

  function patch(updates: Partial<EditState>) {
    const next = { ...draft, ...updates };
    setDraft(next);
    onLocalChange(tier.id, {
      min_score: next.min_score,
      max_score: next.max_score,
      title: next.title,
    });
  }

  function save() {
    setError(null);
    const input: TierInput = {
      min_score: draft.min_score,
      max_score: draft.max_score,
      title: draft.title,
      description: draft.description,
      cta_label: draft.cta_label,
      cta_url: draft.cta_url,
    };
    startTransition(async () => {
      const result = await updateTier(quizId, tier.id, input);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function reset() {
    setDraft(toEditState(tier));
    setError(null);
    onLocalChange(tier.id, {
      min_score: tier.min_score,
      max_score: tier.max_score,
      title: tier.title,
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTier(quizId, tier.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function toggleDocument(documentId: string, currentlyAttached: boolean) {
    setError(null);
    // Optimistic update.
    setAttachedIds((prev) =>
      currentlyAttached
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId],
    );
    startDocTransition(async () => {
      const result = currentlyAttached
        ? await detachDocumentFromTier(tier.id, documentId)
        : await attachDocumentToTier(tier.id, documentId);
      if (!result.ok) {
        // Roll back on failure.
        setAttachedIds((prev) =>
          currentlyAttached
            ? [...prev, documentId]
            : prev.filter((id) => id !== documentId),
        );
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <li className="rounded-lg border border-border bg-background p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">
          Scores {draft.min_score}–{draft.max_score}
        </p>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={isPending}
          className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      </header>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min score" required>
            <input
              type="number"
              min={0}
              value={draft.min_score}
              onChange={(e) => patch({ min_score: parseInt(e.target.value, 10) || 0 })}
              disabled={isPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>
          <Field label="Max score" required>
            <input
              type="number"
              min={0}
              value={draft.max_score}
              onChange={(e) => patch({ max_score: parseInt(e.target.value, 10) || 0 })}
              disabled={isPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>
        </div>

        <Field label="Title" required>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            disabled={isPending}
            maxLength={200}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </Field>

        <Field
          label="Description"
          hint="Shown on the results page below the tier title."
        >
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="CTA label"
            hint="The button text on the results page. Leave both blank for no CTA."
          >
            <input
              type="text"
              value={draft.cta_label}
              onChange={(e) => patch({ cta_label: e.target.value })}
              disabled={isPending}
              maxLength={100}
              placeholder="e.g. Talk to a vCISO"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>
          <Field label="CTA URL">
            <input
              type="url"
              value={draft.cta_url}
              onChange={(e) => patch({ cta_url: e.target.value })}
              disabled={isPending}
              placeholder="https://your-company.com/services"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>
        </div>

        {/* Document attachments */}
        <div className="border-t border-border pt-4">
          <p className="mb-1 text-sm font-semibold text-foreground">Documents</p>
          <p className="mb-3 text-xs text-muted">
            Prospects who land in this tier are automatically granted these documents
            on their results page. Changes save immediately.
          </p>
          {availableDocuments.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-xs text-muted">
              No documents yet. Upload PDFs in the Documents section, then attach them here.
            </p>
          ) : (
            <ul className="space-y-2">
              {availableDocuments.map((doc) => {
                const isAttached = attachedIds.includes(doc.id);
                return (
                  <li key={doc.id} className="flex items-center gap-3">
                    <input
                      id={`doc-${tier.id}-${doc.id}`}
                      type="checkbox"
                      checked={isAttached}
                      disabled={docPending}
                      onChange={() => toggleDocument(doc.id, isAttached)}
                      className="h-4 w-4 rounded border-border accent-brand disabled:opacity-60"
                    />
                    <label
                      htmlFor={`doc-${tier.id}-${doc.id}`}
                      className="flex flex-1 items-center gap-2 text-sm text-foreground"
                    >
                      <span>{doc.title}</span>
                      <span className="rounded-full bg-border/40 px-2 py-0.5 text-xs text-muted">
                        {doc.access_level === "public"
                          ? "Free"
                          : doc.access_level === "email_gated"
                            ? "Gated"
                            : doc.access_level}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {dirty && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={reset}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this tier?"
          body={
            <>
              <p>
                Scores that previously matched this tier will fall through to the
                generic "no tier" fallback on the results page. Historical sessions
                are unaffected.
              </p>
              <p className="mt-2 text-sm text-muted">This cannot be undone.</p>
            </>
          }
          onConfirm={() => {
            setConfirmDelete(false);
            handleDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
          isPending={isPending}
        />
      )}
    </li>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-brand">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string;
  body: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <div className="mt-3 text-sm leading-relaxed text-foreground">{body}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
