"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createQuiz, updateQuizMetadata, type QuizMetadataInput } from "./actions";

type Mode = "create" | "edit";

type QuizMetadataFormProps = {
  mode: Mode;
  quizId?: string; // required when mode = "edit"
  initialValues?: Partial<QuizMetadataInput>;
  // If true, slug field is read-only with explanation (published quizzes can't change slug).
  slugLocked?: boolean;
};

/**
 * Reusable client form for quiz metadata.
 *
 * Used by:
 *   /admin/quizzes/new       (mode="create")
 *   /admin/quizzes/[id]/edit (mode="edit")
 *
 * On success:
 *   create → server action redirects to /admin/quizzes/[id]
 *   edit   → client redirects back to /admin/quizzes/[id]
 */
export function QuizMetadataForm({
  mode,
  quizId,
  initialValues,
  slugLocked,
}: QuizMetadataFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [slug, setSlug] = useState(initialValues?.slug ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [segment, setSegment] = useState(initialValues?.segment ?? "");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-derive slug from title when creating, until user manually edits slug.
  const [slugTouched, setSlugTouched] = useState(false);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (mode === "create" && !slugTouched) {
      setSlug(deriveSlug(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const input: QuizMetadataInput = { title, slug, description, category, segment };

    startTransition(async () => {
      if (mode === "create") {
        const result = await createQuiz(input);
        if (result.ok) {
          router.push(`/admin/quizzes/${result.quiz_id}`);
        } else {
          setError({ message: result.error, field: result.field });
        }
      } else {
        if (!quizId) {
          setError({ message: "Quiz ID is missing — please refresh and try again." });
          return;
        }
        const result = await updateQuizMetadata(quizId, input);
        if (result.ok) {
          router.push(`/admin/quizzes/${quizId}`);
        } else {
          setError({ message: result.error, field: result.field });
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field
        label="Title"
        required
        error={error?.field === "title" ? error.message : null}
        hint="Shown at the top of the public quiz page."
      >
        <input
          name="title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          placeholder="e.g. Cyber Readiness Assessment"
        />
      </Field>

      <Field
        label="Slug"
        required
        error={error?.field === "slug" ? error.message : null}
        hint={
          slugLocked
            ? "Slug locked — this quiz has been published. Inbound links would break if changed."
            : "Lowercase letters, numbers, and hyphens only. Appears in the URL: /q/<slug>"
        }
      >
        <div className="flex items-stretch gap-2">
          <span className="rounded-md border border-border bg-border/30 px-3 py-2 font-mono text-sm text-muted">
            /q/
          </span>
          <input
            name="slug"
            type="text"
            required
            maxLength={80}
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            disabled={isPending || slugLocked}
            readOnly={slugLocked}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            placeholder="cyber-readiness"
          />
        </div>
      </Field>

      <Field
        label="Description"
        error={error?.field === "description" ? error.message : null}
        hint="Optional. Shown under the title on the public quiz page."
      >
        <textarea
          name="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          placeholder="A quick 5-question assessment to gauge your organization's cybersecurity readiness."
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Category"
          error={error?.field === "category" ? error.message : null}
          hint="Topic grouping (e.g. 'Cyber Readiness'). Quizzes sharing a category are conceptually related."
        >
          <input
            name="category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            placeholder="Cyber Readiness"
          />
        </Field>

        <Field
          label="Segment"
          error={error?.field === "segment" ? error.message : null}
          hint="Audience tag (e.g. 'Healthcare', 'Manufacturing'). Use 'General' for unsegmented quizzes."
        >
          <input
            name="segment"
            type="text"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            placeholder="General"
          />
        </Field>
      </div>

      {error && !error.field && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {isPending ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              Saving...
            </>
          ) : mode === "create" ? (
            "Create quiz"
          ) : (
            "Save changes"
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-brand">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function deriveSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // strip non-alphanumeric, non-space, non-hyphen
    .replace(/\s+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // strip leading/trailing hyphens
}
