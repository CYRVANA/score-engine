"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TierEditor, type TierForEdit } from "./TierEditor";
import { addTier } from "./actions";

export function TiersManager({
  quizId,
  initialTiers,
  onTiersChange,
}: {
  quizId: string;
  initialTiers: TierForEdit[];
  onTiersChange?: (tiers: { min_score: number; max_score: number; title: string }[]) => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    min_score: 0,
    max_score: 10,
    title: "",
    description: "",
    cta_label: "",
    cta_url: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Track each tier's live (possibly unsaved) range + title so the coverage
  // box in the parent QuestionsManager updates as you edit.
  const [liveState, setLiveState] = useState<
    Record<string, { min_score: number; max_score: number; title: string }>
  >(() => {
    const map: Record<string, { min_score: number; max_score: number; title: string }> = {};
    for (const t of initialTiers) {
      map[t.id] = { min_score: t.min_score, max_score: t.max_score, title: t.title };
    }
    return map;
  });

  function handleLocalTierChange(
    tid: string,
    range: { min_score: number; max_score: number; title: string },
  ) {
    setLiveState((prev) => {
      const next = { ...prev, [tid]: range };
      if (onTiersChange) {
        onTiersChange(initialTiers.map((t) => next[t.id] ?? t));
      }
      return next;
    });
  }

  function cancelAdd() {
    setAdding(false);
    setDraft({
      min_score: 0,
      max_score: 10,
      title: "",
      description: "",
      cta_label: "",
      cta_url: "",
    });
    setError(null);
  }

  function submitAdd() {
    setError(null);
    startTransition(async () => {
      const result = await addTier(quizId, draft);
      if (!result.ok) {
        setError(result.error);
      } else {
        cancelAdd();
        router.refresh();
      }
    });
  }

  return (
    <section>
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-bold text-foreground">
          Result tiers ({initialTiers.length})
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={isPending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            + Add tier
          </button>
        )}
      </header>

      {initialTiers.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
          <p className="text-base font-semibold text-foreground">No tiers yet.</p>
          <p className="mt-2 text-sm text-muted">
            Click + Add tier to define a score range and result.
          </p>
        </div>
      ) : (
        <ol className="space-y-4">
          {initialTiers.map((t) => (
            <TierEditor
              key={t.id}
              quizId={quizId}
              tier={t}
              onLocalChange={handleLocalTierChange}
            />
          ))}
        </ol>
      )}

      {adding && (
        <div className="mt-4 rounded-lg border-2 border-brand/30 bg-background p-5">
          <header className="mb-4 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-brand">
              New tier
            </p>
            <button
              type="button"
              onClick={cancelAdd}
              disabled={isPending}
              className="text-xs text-muted hover:text-foreground"
            >
              ✕ Close
            </button>
          </header>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Min score" required>
                <input
                  type="number"
                  min={0}
                  value={draft.min_score}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      min_score: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  disabled={isPending}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
              </Field>
              <Field label="Max score" required>
                <input
                  type="number"
                  min={0}
                  value={draft.max_score}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      max_score: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  disabled={isPending}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
              </Field>
            </div>

            <Field label="Title" required>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                disabled={isPending}
                maxLength={200}
                placeholder="e.g. Mature"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />
            </Field>

            <Field label="Description">
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                disabled={isPending}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="CTA label">
                <input
                  type="text"
                  value={draft.cta_label}
                  onChange={(e) => setDraft({ ...draft, cta_label: e.target.value })}
                  disabled={isPending}
                  maxLength={100}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
              </Field>
              <Field label="CTA URL">
                <input
                  type="url"
                  value={draft.cta_url}
                  onChange={(e) => setDraft({ ...draft, cta_url: e.target.value })}
                  disabled={isPending}
                  placeholder="https://..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
              </Field>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={cancelAdd}
                disabled={isPending}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAdd}
                disabled={isPending}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {isPending ? "Adding..." : "Add tier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-brand">*</span>}
      </label>
      {children}
    </div>
  );
}
