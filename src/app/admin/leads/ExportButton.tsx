"use client";

import { useState, useTransition } from "react";
import { exportLeads } from "./actions";

/**
 * Export button — calls the Server Action, then triggers a browser download
 * by creating a Blob and a temporary anchor element.
 *
 * We do this client-side rather than streaming the CSV from a route handler
 * because Server Actions are simpler and the file sizes involved (max 10k
 * rows = ~1MB) are well within memory.
 */
export function ExportButton({
  quizId,
  searchQuery,
  disabled,
}: {
  quizId: string | null;
  searchQuery: string;
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await exportLeads({ quizId, searchQuery });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Trigger the download by creating a Blob URL and clicking a hidden anchor.
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the download has fully initiated.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-border/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
          <>
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent"
            />
            Building CSV...
          </>
        ) : (
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path
                d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export CSV
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
