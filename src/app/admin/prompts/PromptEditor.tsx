"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  savePromptTemplate,
  previewPromptAgainstLatest,
} from "./actions";

type QuizOption = { id: string; title: string };

type PreviewState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; narrative: string; rendered_prompt: string }
  | { kind: "error"; error: string };

const AVAILABLE_MODELS = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest, faster)" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (most capable, ~5x cost)" },
];

export function PromptEditor({
  initialName,
  initialBody,
  initialModel,
  quizzes,
}: {
  initialName: string;
  initialBody: string;
  initialModel: string;
  quizzes: QuizOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [body, setBody] = useState(initialBody);
  const [model, setModel] = useState(initialModel);
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewQuizId, setPreviewQuizId] = useState<string>(
    quizzes[0]?.id ?? "",
  );
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });

  const [isSaving, startSave] = useTransition();
  const [isPreviewing, startPreview] = useTransition();

  function handleSave() {
    setError(null);
    startSave(async () => {
      const result = await savePromptTemplate({ name, body, model, activate });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handlePreview() {
    if (!previewQuizId) return;
    setPreview({ kind: "running" });
    startPreview(async () => {
      const result = await previewPromptAgainstLatest(previewQuizId, body, model);
      if (result.ok) {
        setPreview({
          kind: "success",
          narrative: result.narrative,
          rendered_prompt: result.rendered_prompt,
        });
      } else {
        setPreview({ kind: "error", error: result.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-foreground">
            Name <span className="text-brand">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            maxLength={200}
            placeholder="e.g. Cyber Readiness v3"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-muted">
            Internal label. Use versioning so you remember which prompt produced which results.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-foreground">
            Model <span className="text-brand">*</span>
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isSaving}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">
          Prompt body <span className="text-brand">*</span>
        </label>
        <textarea
          rows={16}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isSaving}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-muted">
          Available placeholders:{" "}
          <code className="rounded bg-border/40 px-1">{"{{quiz_title}}"}</code>,{" "}
          <code className="rounded bg-border/40 px-1">{"{{quiz_description}}"}</code>,{" "}
          <code className="rounded bg-border/40 px-1">{"{{tier_title}}"}</code>,{" "}
          <code className="rounded bg-border/40 px-1">{"{{tier_description}}"}</code>,{" "}
          <code className="rounded bg-border/40 px-1">{"{{score}}"}</code>,{" "}
          <code className="rounded bg-border/40 px-1">{"{{answers_summary}}"}</code>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="activate"
          type="checkbox"
          checked={activate}
          onChange={(e) => setActivate(e.target.checked)}
          disabled={isSaving}
          className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
        />
        <label htmlFor="activate" className="text-sm text-foreground">
          Make this the active prompt for all new sessions
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save as new version"}
        </button>
      </div>

      {/* Preview area */}
      {quizzes.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-5">
          <h3 className="text-base font-semibold text-foreground">
            Preview against a real session
          </h3>
          <p className="mt-1 text-sm text-muted">
            Generate a narrative using this prompt + the most recent completed session
            from a chosen quiz. Costs about $0.005 per preview.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="mb-1.5 block text-xs font-semibold text-muted">
                Quiz
              </label>
              <select
                value={previewQuizId}
                onChange={(e) => setPreviewQuizId(e.target.value)}
                disabled={isPreviewing}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              >
                {quizzes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing || !previewQuizId}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
            >
              {isPreviewing ? "Generating..." : "Generate preview"}
            </button>
          </div>

          {preview.kind === "running" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted">
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent"
              />
              Calling Anthropic...
            </div>
          )}

          {preview.kind === "success" && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                  Generated narrative
                </p>
                <div className="space-y-2 rounded-md border border-brand/20 bg-brand/5 p-4 text-sm leading-relaxed text-foreground">
                  {preview.narrative.split(/\n\n+/).map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
                </div>
              </div>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer font-semibold">
                  Show rendered prompt (what was sent to the model)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-border/30 p-3 font-mono">
                  {preview.rendered_prompt}
                </pre>
              </details>
            </div>
          )}

          {preview.kind === "error" && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {preview.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
