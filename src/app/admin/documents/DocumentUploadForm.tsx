"use client";

import { useState, useTransition, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createDocument } from "./actions";

export function DocumentUploadForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [accessLevel, setAccessLevel] = useState<"public" | "email_gated">("email_gated");
  const [isDirect, setIsDirect] = useState(true);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-generate slug from title.
  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slug || slug === slugify(title)) {
      setSlug(slugify(value));
    }
  }

  function handleFileChange() {
    const file = fileRef.current?.files?.[0];
    setFileName(file?.name ?? null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("is_direct_accessible", isDirect ? "true" : "false");

    startTransition(async () => {
      const result = await createDocument(data);
      if (result.ok) {
        router.refresh();
        onDone?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>
          <input
            name="title"
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Starter Playbook: The Five Free Switches"
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Slug" required hint="Used in the URL: /get/your-slug">
          <input
            name="slug"
            type="text"
            required
            maxLength={100}
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            disabled={isPending}
            placeholder="starter-playbook"
            className={INPUT_CLS}
          />
        </Field>
      </div>

      <Field label="Description" hint="Shown on the download gate page and results page.">
        <textarea
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isPending}
          placeholder="A concise description of what's in this resource."
          className={INPUT_CLS}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Access level" required>
          <select
            name="access_level"
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as "public" | "email_gated")}
            disabled={isPending}
            className={INPUT_CLS}
          >
            <option value="email_gated">Email gated (requires form submission)</option>
            <option value="public">Public (no gate, direct download)</option>
          </select>
        </Field>
        <Field label="PDF file" required>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted transition hover:border-brand/50 ${isPending ? "opacity-60" : ""}`}
          >
            <span aria-hidden="true">📄</span>
            <span className="flex-1 truncate">
              {fileName ?? "Choose PDF file…"}
            </span>
            <input
              ref={fileRef}
              name="file"
              type="file"
              accept="application/pdf"
              required
              onChange={handleFileChange}
              disabled={isPending}
              className="sr-only"
            />
          </label>
          <p className="mt-1 text-xs text-muted">PDF only, max 50MB.</p>
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is_direct"
          type="checkbox"
          checked={isDirect}
          onChange={(e) => setIsDirect(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 rounded border-border accent-brand"
        />
        <label htmlFor="is_direct" className="text-sm text-foreground">
          Make available at <code className="rounded bg-border/40 px-1 text-xs">/get/{slug || "slug"}</code> (direct download gate)
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {isPending ? "Uploading…" : "Upload document"}
        </button>
      </div>
    </form>
  );
}

const INPUT_CLS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60";

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

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}
