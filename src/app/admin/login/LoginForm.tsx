"use client";

import { useState, useTransition, type FormEvent } from "react";
import { sendMagicLink } from "./actions";

type FormState =
  | { kind: "idle"; error: string | null }
  | { kind: "sent"; email: string };

export function LoginForm() {
  const [state, setState] = useState<FormState>({ kind: "idle", error: null });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setState({ kind: "idle", error: null });

    startTransition(async () => {
      const result = await sendMagicLink(formData);
      if (result.ok) {
        setState({ kind: "sent", email: result.sent_to });
      } else {
        setState({ kind: "idle", error: result.error });
      }
    });
  }

  if (state.kind === "sent") {
    return (
      <div className="rounded-md border border-brand/30 bg-brand/5 px-6 py-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand/20">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5 text-brand"
          >
            <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          We sent a sign-in link to <strong className="text-white">{state.email}</strong>.
          Click the link in the email to continue. It expires in 60 minutes.
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: "idle", error: null })}
          className="mt-6 text-xs text-white/50 hover:text-white/80"
        >
          Use a different email →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-sm font-semibold text-white/90"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          disabled={isPending}
          className="w-full rounded-md border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/30 transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          placeholder="you@your-domain.com"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
          <>
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            />
            Sending link...
          </>
        ) : (
          "Send magic link"
        )}
      </button>
    </form>
  );
}
