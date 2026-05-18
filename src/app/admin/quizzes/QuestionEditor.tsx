"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateQuestion,
  deleteQuestion,
  moveQuestion,
  type QuestionInput,
  type QuestionOption,
} from "./actions";

export type QuestionForEdit = {
  id: string;
  order_index: number;
  prompt: string;
  weight: number;
  options: QuestionOption[];
};

type EditState = {
  prompt: string;
  weight: number;
  options: QuestionOption[];
};

function toEditState(q: QuestionForEdit): EditState {
  return {
    prompt: q.prompt,
    weight: q.weight,
    options: q.options.map((o) => ({ label: o.label, points: o.points })),
  };
}

function isDirty(orig: QuestionForEdit, draft: EditState): boolean {
  if (orig.prompt !== draft.prompt) return true;
  if (orig.weight !== draft.weight) return true;
  if (orig.options.length !== draft.options.length) return true;
  for (let i = 0; i < orig.options.length; i++) {
    if (orig.options[i].label !== draft.options[i].label) return true;
    if (orig.options[i].points !== draft.options[i].points) return true;
  }
  return false;
}

/**
 * Editor for a single question. Holds local state for prompt/weight/options;
 * the Save Changes button posts to updateQuestion when dirty. Reorder and
 * delete operations persist immediately.
 *
 * Parent (QuestionsManager) is notified via onLocalChange whenever options
 * mutate, so coverage analysis can update in real time without waiting for a
 * Save round-trip.
 */
export function QuestionEditor({
  quizId,
  question,
  position,
  total,
  onLocalChange,
}: {
  quizId: string;
  question: QuestionForEdit;
  position: number;
  total: number;
  onLocalChange: (qid: string, opts: QuestionOption[], weight: number) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditState>(toEditState(question));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty = isDirty(question, draft);

  function patch(updates: Partial<EditState>) {
    const next = { ...draft, ...updates };
    setDraft(next);
    onLocalChange(question.id, next.options, next.weight);
  }

  function patchOption(idx: number, patchOpt: Partial<QuestionOption>) {
    const opts = draft.options.map((o, i) => (i === idx ? { ...o, ...patchOpt } : o));
    patch({ options: opts });
  }

  function addOption() {
    if (draft.options.length >= 12) return;
    patch({ options: [...draft.options, { label: "", points: 0 }] });
  }

  function removeOption(idx: number) {
    if (draft.options.length <= 2) return; // must keep at least 2
    patch({ options: draft.options.filter((_, i) => i !== idx) });
  }

  function moveOption(idx: number, direction: "up" | "down") {
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= draft.options.length) return;
    const opts = [...draft.options];
    [opts[idx], opts[swap]] = [opts[swap], opts[idx]];
    patch({ options: opts });
  }

  function save() {
    setError(null);
    const input: QuestionInput = {
      prompt: draft.prompt,
      weight: draft.weight,
      options: draft.options,
    };
    startTransition(async () => {
      const result = await updateQuestion(quizId, question.id, input);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function reset() {
    setDraft(toEditState(question));
    setError(null);
    onLocalChange(question.id, question.options, question.weight);
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteQuestion(quizId, question.id);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleMove(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await moveQuestion(quizId, question.id, direction);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-border bg-background p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Question {position}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <IconButton
            label="Move up"
            disabled={position === 1 || isPending}
            onClick={() => handleMove("up")}
          >
            ▲
          </IconButton>
          <IconButton
            label="Move down"
            disabled={position === total || isPending}
            onClick={() => handleMove("down")}
          >
            ▼
          </IconButton>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={isPending}
            className="ml-2 rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      </header>

      <div className="space-y-4">
        <Field label="Prompt" required>
          <textarea
            rows={2}
            value={draft.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
            disabled={isPending}
            maxLength={500}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </Field>

        <Field
          label="Weight"
          hint="Multiplier applied to each option's points (1 = no multiplier)."
        >
          <input
            type="number"
            min={1}
            max={10}
            value={draft.weight}
            onChange={(e) => patch({ weight: parseInt(e.target.value, 10) || 1 })}
            disabled={isPending}
            className="w-24 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </Field>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="text-sm font-semibold text-foreground">
              Options ({draft.options.length})
            </label>
            <button
              type="button"
              onClick={addOption}
              disabled={isPending || draft.options.length >= 12}
              className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
            >
              + Add option
            </button>
          </div>

          <ul className="space-y-2">
            {draft.options.map((opt, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 rounded-md border border-border bg-background p-2"
              >
                <div className="flex flex-col gap-0.5">
                  <IconButton
                    label="Move option up"
                    disabled={idx === 0 || isPending}
                    onClick={() => moveOption(idx, "up")}
                    small
                  >
                    ▲
                  </IconButton>
                  <IconButton
                    label="Move option down"
                    disabled={idx === draft.options.length - 1 || isPending}
                    onClick={() => moveOption(idx, "down")}
                    small
                  >
                    ▼
                  </IconButton>
                </div>
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => patchOption(idx, { label: e.target.value })}
                  disabled={isPending}
                  maxLength={300}
                  placeholder="Option label"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={opt.points}
                  onChange={(e) =>
                    patchOption(idx, { points: parseInt(e.target.value, 10) || 0 })
                  }
                  disabled={isPending}
                  className="w-20 rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                  aria-label="Points"
                />
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  disabled={isPending || draft.options.length <= 2}
                  title={
                    draft.options.length <= 2
                      ? "Questions need at least 2 options"
                      : "Remove option"
                  }
                  className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-30"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
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
          title="Delete this question?"
          body={
            <>
              <p>
                This removes the question and any historical answers to it. Scores on
                past sessions remain intact (they were denormalized at submit time).
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

function IconButton({
  label,
  onClick,
  disabled,
  children,
  small,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-border bg-background text-foreground transition hover:bg-border/30 disabled:opacity-30 ${
        small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
    >
      {children}
    </button>
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
