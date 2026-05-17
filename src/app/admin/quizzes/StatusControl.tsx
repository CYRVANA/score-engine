"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeQuizStatus } from "./actions";

type QuizStatus = "draft" | "published" | "archived";

const STATUS_LABELS: Record<QuizStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const STATUS_BADGE_CLASSES: Record<QuizStatus, string> = {
  draft: "bg-border/40 text-muted",
  published: "bg-brand/10 text-brand-700",
  archived: "bg-foreground/5 text-muted",
};

/**
 * Inline status badge + dropdown for changing a quiz's status.
 *
 * Confirmation modal appears for destructive transitions:
 *   - published → archived (would break public URL)
 *   - published → draft (would break public URL)
 *
 * draft → published also confirms (with a different message), since
 * publishing a quiz makes its public URL live.
 */
export function StatusControl({
  quizId,
  currentStatus,
}: {
  quizId: string;
  currentStatus: QuizStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<QuizStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function attemptChange(target: QuizStatus) {
    if (target === currentStatus) return;
    setPending(target);
  }

  function cancel() {
    setPending(null);
    setError(null);
  }

  function confirm() {
    if (!pending) return;
    const target = pending;
    setError(null);
    startTransition(async () => {
      const result = await changeQuizStatus(quizId, target);
      if (result.ok) {
        setPending(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <div className="relative inline-flex items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[currentStatus]}`}
        >
          {STATUS_LABELS[currentStatus]}
        </span>
        <select
          aria-label="Change status"
          value={currentStatus}
          onChange={(e) => attemptChange(e.target.value as QuizStatus)}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {pending && (
        <ConfirmModal
          from={currentStatus}
          to={pending}
          error={error}
          isPending={isPending}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
    </>
  );
}

function ConfirmModal({
  from,
  to,
  error,
  isPending,
  onConfirm,
  onCancel,
}: {
  from: QuizStatus;
  to: QuizStatus;
  error: string | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { title, body, ctaLabel, ctaTone } = messageFor(from, to);

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
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

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
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
              ctaTone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand hover:bg-brand-600"
            }`}
          >
            {isPending ? "Saving..." : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function messageFor(
  from: QuizStatus,
  to: QuizStatus,
): { title: string; body: string; ctaLabel: string; ctaTone: "primary" | "danger" } {
  if (from === "published" && (to === "draft" || to === "archived")) {
    return {
      title: to === "archived" ? "Archive this quiz?" : "Unpublish this quiz?",
      body:
        to === "archived"
          ? "Archiving makes the public URL return a 404. Existing leads stay in your database. You can unarchive later."
          : "Moving back to draft makes the public URL return a 404. Existing leads stay in your database.",
      ctaLabel: to === "archived" ? "Archive" : "Move to draft",
      ctaTone: "danger",
    };
  }
  if (to === "published") {
    return {
      title: "Publish this quiz?",
      body: "Publishing makes the public URL live and accessible to anyone with the link.",
      ctaLabel: "Publish",
      ctaTone: "primary",
    };
  }
  return {
    title: "Change status?",
    body: `Move this quiz from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`,
    ctaLabel: "Confirm",
    ctaTone: "primary",
  };
}
