"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cloneQuiz, deleteQuiz } from "./actions";

type DialogState =
  | { kind: "none" }
  | { kind: "clone-confirm" }
  | { kind: "clone-success"; newQuizId: string; newSlug: string }
  | { kind: "delete-confirm" }
  | { kind: "delete-blocked"; leadCount: number };

/**
 * Action buttons that sit at the top of the quiz detail page next to the
 * status control. Handles cloning and deletion with confirmation modals.
 */
export function QuizActions({ quizId }: { quizId: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClone() {
    setError(null);
    startTransition(async () => {
      const result = await cloneQuiz(quizId);
      if (result.ok) {
        setDialog({
          kind: "clone-success",
          newQuizId: result.new_quiz_id,
          newSlug: result.new_slug,
        });
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteQuiz(quizId);
      if (result.ok) {
        router.push("/admin/quizzes");
      } else if (result.lead_count !== undefined) {
        setDialog({ kind: "delete-blocked", leadCount: result.lead_count });
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDialog({ kind: "clone-confirm" })}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-border/30 disabled:opacity-60"
        >
          Clone as variant
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: "delete-confirm" })}
          disabled={isPending}
          className="rounded-md border border-red-200 bg-background px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      </div>

      {dialog.kind === "clone-confirm" && (
        <Modal
          title="Clone this quiz as a variant?"
          body={
            <>
              <p>
                A new draft quiz will be created with all of this quiz&apos;s questions,
                options, and tiers copied across. The original is unchanged.
              </p>
              <p className="mt-3 text-sm text-muted">
                Use this to create sector variants (e.g. healthcare, manufacturing) of an
                existing quiz.
              </p>
            </>
          }
          confirmLabel="Create clone"
          confirmTone="primary"
          isPending={isPending}
          onConfirm={handleClone}
          onCancel={() => setDialog({ kind: "none" })}
          error={error}
        />
      )}

      {dialog.kind === "clone-success" && (
        <Modal
          title="Clone created"
          body={
            <>
              <p>
                The new quiz is a draft at <code className="font-mono">/q/{dialog.newSlug}</code>.
                Edit its metadata and add or modify questions before publishing.
              </p>
            </>
          }
          confirmLabel="Open the clone"
          confirmTone="primary"
          isPending={false}
          onConfirm={() => {
            router.push(`/admin/quizzes/${dialog.newQuizId}`);
          }}
          onCancel={() => {
            setDialog({ kind: "none" });
            router.refresh();
          }}
          cancelLabel="Stay here"
        />
      )}

      {dialog.kind === "delete-confirm" && (
        <Modal
          title="Delete this quiz?"
          body={
            <>
              <p>
                <strong className="text-foreground">This cannot be undone.</strong> The
                quiz, all questions, all options, and all tiers will be removed.
              </p>
              <p className="mt-3 text-sm text-muted">
                If this quiz has captured leads, deletion will be blocked. Archive instead
                to keep the lead history.
              </p>
            </>
          }
          confirmLabel="Delete permanently"
          confirmTone="danger"
          isPending={isPending}
          onConfirm={handleDelete}
          onCancel={() => setDialog({ kind: "none" })}
          error={error}
        />
      )}

      {dialog.kind === "delete-blocked" && (
        <Modal
          title="Can't delete this quiz"
          body={
            <>
              <p>
                This quiz has{" "}
                <strong className="text-foreground">
                  {dialog.leadCount.toLocaleString()} lead
                  {dialog.leadCount === 1 ? "" : "s"}
                </strong>{" "}
                attached. Deleting would remove their historical answers and scores.
              </p>
              <p className="mt-3 text-sm text-muted">
                Archive the quiz instead — its public URL will stop working but the lead
                data stays intact.
              </p>
            </>
          }
          confirmLabel="Got it"
          confirmTone="primary"
          isPending={false}
          onConfirm={() => setDialog({ kind: "none" })}
          onCancel={() => setDialog({ kind: "none" })}
          cancelLabel={null}
        />
      )}
    </>
  );
}

function Modal({
  title,
  body,
  confirmLabel,
  confirmTone,
  isPending,
  onConfirm,
  onCancel,
  cancelLabel = "Cancel",
  error,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmTone: "primary" | "danger";
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string | null;
  error?: string | null;
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
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl sm:p-7">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground">{body}</div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {cancelLabel !== null && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
              confirmTone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand hover:bg-brand-600"
            }`}
          >
            {isPending ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
