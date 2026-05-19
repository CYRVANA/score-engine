"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createDestination, testHubSpotToken } from "./actions";

type QuizOption = { id: string; title: string };

export function NewDestinationForm({ quizzes }: { quizzes: QuizOption[] }) {
  const router = useRouter();
  const [type, setType] = useState<"hubspot" | "generic_webhook">("hubspot");
  const [name, setName] = useState("");
  const [quizId, setQuizId] = useState<string>("all");
  // HubSpot fields
  const [token, setToken] = useState("");
  // Webhook fields
  const [url, setUrl] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  // Test state
  const [testStatus, setTestStatus] = useState<
    { kind: "idle" } | { kind: "ok"; details: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isTesting, startTest] = useTransition();

  function handleTest() {
    setTestStatus({ kind: "idle" });
    startTest(async () => {
      if (type === "hubspot") {
        if (!token) {
          setTestStatus({ kind: "error", message: "Paste a token first." });
          return;
        }
        const result = await testHubSpotToken(token);
        if (result.ok) setTestStatus({ kind: "ok", details: result.details });
        else setTestStatus({ kind: "error", message: result.error });
      } else {
        setTestStatus({
          kind: "ok",
          details: "Webhook URLs are validated on save (no pre-test).",
        });
      }
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const config: Record<string, unknown> = {};
    if (type === "hubspot") {
      config.access_token = token.trim();
    } else {
      config.url = url.trim();
      if (sharedSecret.trim()) config.shared_secret = sharedSecret.trim();
    }

    startTransition(async () => {
      const result = await createDestination({
        name,
        type,
        quiz_id: quizId === "all" ? null : quizId,
        config,
      });
      if (result.ok) {
        router.push(`/admin/destinations/${result.destination_id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field label="Name" required hint="An internal label so you can recognize this destination.">
        <input
          type="text"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          placeholder="e.g. CYRVANA HubSpot — production"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        />
      </Field>

      <Field label="Type" required>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "hubspot" | "generic_webhook")}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        >
          <option value="hubspot">HubSpot (Contact upsert)</option>
          <option value="generic_webhook">Generic webhook (POST JSON to a URL)</option>
        </select>
      </Field>

      <Field
        label="Scope"
        hint="Apply to all quizzes in your workspace, or only one specific quiz."
      >
        <select
          value={quizId}
          onChange={(e) => setQuizId(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        >
          <option value="all">All quizzes</option>
          {quizzes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      </Field>

      {type === "hubspot" && (
        <Field
          label="Private App Token"
          required
          hint="Create a Private App in HubSpot with scopes: crm.objects.contacts.read, crm.objects.contacts.write, crm.schemas.contacts.write. Token starts with 'pat-'."
        >
          <input
            type="password"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isPending}
            placeholder="pat-na1-..."
            autoComplete="off"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </Field>
      )}

      {type === "generic_webhook" && (
        <>
          <Field
            label="URL"
            required
            hint="The HTTP endpoint we'll POST to with each lead payload."
          >
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isPending}
              placeholder="https://your-service.example/webhooks/score-engine"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>

          <Field
            label="Shared secret"
            hint="Optional. If set, sent as X-Score-Engine-Secret header so your endpoint can verify the source."
          >
            <input
              type="password"
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
              disabled={isPending}
              autoComplete="off"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
          </Field>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-border/10 p-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={isTesting || (type === "hubspot" && !token)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
        >
          {isTesting ? "Testing..." : "Test connection"}
        </button>
        {testStatus.kind === "ok" && (
          <p className="text-sm text-brand-700">✓ {testStatus.details}</p>
        )}
        {testStatus.kind === "error" && (
          <p className="text-sm text-red-700">✗ {testStatus.message}</p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-6">
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
          className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Create destination"}
        </button>
      </div>
    </form>
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
      <label className="mb-2 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-brand">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
