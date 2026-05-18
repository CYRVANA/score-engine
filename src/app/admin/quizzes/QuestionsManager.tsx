"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { QuestionEditor, type QuestionForEdit } from "./QuestionEditor";
import { CoverageBox, type CoverageQuestion, type CoverageTier } from "./CoverageBox";
import { addQuestion, type QuestionOption } from "./actions";

/**
 * QuestionsManager owns the rendered list of QuestionEditor components and
 * a parallel in-memory map of each question's *current* (possibly unsaved)
 * options + weight, used to drive real-time coverage updates.
 *
 * Tiers come in already-saved from the parent page; the CoverageBox combines
 * the live in-memory questions with the saved tiers.
 */
export function QuestionsManager({
  quizId,
  initialQuestions,
  tiers,
}: {
  quizId: string;
  initialQuestions: QuestionForEdit[];
  tiers: CoverageTier[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newWeight, setNewWeight] = useState(1);
  const [newOptions, setNewOptions] = useState<QuestionOption[]>([
    { label: "", points: 0 },
    { label: "", points: 0 },
  ]);
  const [addError, setAddError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Track the live in-memory state of each existing question for coverage.
  // Keyed by question id. Initialized from props.
  const [liveState, setLiveState] = useState<
    Record<string, { options: QuestionOption[]; weight: number }>
  >(() => {
    const map: Record<string, { options: QuestionOption[]; weight: number }> = {};
    for (const q of initialQuestions) {
      map[q.id] = { options: q.options, weight: q.weight };
    }
    return map;
  });

  function handleLocalChange(qid: string, opts: QuestionOption[], weight: number) {
    setLiveState((prev) => ({ ...prev, [qid]: { options: opts, weight } }));
  }

  // Recompute coverage inputs whenever liveState changes.
  const coverageQuestions: CoverageQuestion[] = useMemo(() => {
    return initialQuestions
      .map((q) => {
        const live = liveState[q.id];
        return {
          weight: live?.weight ?? q.weight,
          options: (live?.options ?? q.options).map((o) => ({ points: o.points })),
        };
      })
      // Also include the in-flight new question (if user has started typing options
      // with valid point values, fold them in for live coverage preview).
      .concat(
        adding && newOptions.some((o) => o.label.trim())
          ? [
              {
                weight: newWeight,
                options: newOptions.map((o) => ({ points: o.points })),
              },
            ]
          : [],
      );
  }, [initialQuestions, liveState, adding, newOptions, newWeight]);

  function patchNewOption(idx: number, patch: Partial<QuestionOption>) {
    setNewOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function addNewOption() {
    if (newOptions.length >= 12) return;
    setNewOptions((prev) => [...prev, { label: "", points: 0 }]);
  }

  function removeNewOption(idx: number) {
    if (newOptions.length <= 2) return;
    setNewOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function cancelAdd() {
    setAdding(false);
    setNewPrompt("");
    setNewWeight(1);
    setNewOptions([
      { label: "", points: 0 },
      { label: "", points: 0 },
    ]);
    setAddError(null);
  }

  function submitAdd() {
    setAddError(null);
    startTransition(async () => {
      const result = await addQuestion(quizId, {
        prompt: newPrompt,
        weight: newWeight,
        options: newOptions,
      });
      if (!result.ok) {
        setAddError(result.error);
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
          Questions ({initialQuestions.length})
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={isPending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            + Add question
          </button>
        )}
      </header>

      {/* Coverage box — sits at the top so changes are visible without scrolling */}
      <div className="mb-6">
        <CoverageBox questions={coverageQuestions} tiers={tiers} />
      </div>

      {initialQuestions.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
          <p className="text-base font-semibold text-foreground">No questions yet.</p>
          <p className="mt-2 text-sm text-muted">Click + Add question to get started.</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {initialQuestions.map((q, idx) => (
            <QuestionEditor
              key={q.id}
              quizId={quizId}
              question={q}
              position={idx + 1}
              total={initialQuestions.length}
              onLocalChange={handleLocalChange}
            />
          ))}
        </ol>
      )}

      {/* Add question form (inline at bottom of list) */}
      {adding && (
        <div className="mt-4 rounded-lg border-2 border-brand/30 bg-background p-5">
          <header className="mb-4 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-brand">
              New question
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
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">
                Prompt <span className="text-brand">*</span>
              </label>
              <textarea
                rows={2}
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                disabled={isPending}
                maxLength={500}
                placeholder="e.g. How often do you review your access controls?"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">
                Weight
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={newWeight}
                onChange={(e) => setNewWeight(parseInt(e.target.value, 10) || 1)}
                disabled={isPending}
                className="w-24 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <label className="text-sm font-semibold text-foreground">
                  Options ({newOptions.length})
                </label>
                <button
                  type="button"
                  onClick={addNewOption}
                  disabled={isPending || newOptions.length >= 12}
                  className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
                >
                  + Add option
                </button>
              </div>
              <ul className="space-y-2">
                {newOptions.map((opt, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
                  >
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => patchNewOption(idx, { label: e.target.value })}
                      disabled={isPending}
                      maxLength={300}
                      placeholder={`Option ${idx + 1} label`}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={opt.points}
                      onChange={(e) =>
                        patchNewOption(idx, {
                          points: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      disabled={isPending}
                      className="w-20 rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                      aria-label="Points"
                    />
                    <button
                      type="button"
                      onClick={() => removeNewOption(idx)}
                      disabled={isPending || newOptions.length <= 2}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {addError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {addError}
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
                {isPending ? "Adding..." : "Add question"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
