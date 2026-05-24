"use client";

/**
 * Delete button with a confirmation dialog.
 *
 * Extracted into a client component because the confirm() dialog needs an
 * onClick handler, which server components cannot use. The server action is
 * passed in as a prop (allowed — only event handlers are forbidden across
 * the server/client boundary).
 */
export function DeleteDocumentButton({
  title,
  onDelete,
}: {
  title: string;
  onDelete: () => Promise<void>;
}) {
  return (
    <form action={onDelete}>
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-background px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
        onClick={(e) => {
          if (!confirm(`Delete "${title}"? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        Delete
      </button>
    </form>
  );
}
