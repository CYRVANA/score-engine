"use client";

import { useEffect, useState } from "react";
import { getNarrativeStatus } from "./actions";

type PollState =
  | { kind: "loading" }
  | { kind: "ready"; body: string }
  | { kind: "failed"; error: string }
  | { kind: "missing" };

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 60000;

/**
 * Narrative loader — polls getNarrativeStatus every 2s until the narrative
 * resolves to ready/failed, then renders the result.
 *
 * Gives up after 60s of polling and shows a "still generating, refresh later"
 * state. The narrative will eventually generate via the background worker;
 * a page refresh after a minute will pick it up.
 */
export function NarrativeLoader({
  sessionId,
  initialState,
}: {
  sessionId: string;
  initialState?: PollState;
}) {
  const [state, setState] = useState<PollState>(initialState ?? { kind: "loading" });

  useEffect(() => {
    // If we already loaded a final state at SSR time, don't poll.
    if (state.kind === "ready" || state.kind === "failed" || state.kind === "missing") {
      return;
    }

    let cancelled = false;
    const start = Date.now();

    async function poll() {
      if (cancelled) return;
      try {
        const result = await getNarrativeStatus(sessionId);
        if (cancelled) return;

        if (result.status === "ready") {
          setState({ kind: "ready", body: result.body });
        } else if (result.status === "failed") {
          setState({ kind: "failed", error: result.error });
        } else if (result.status === "missing") {
          setState({ kind: "missing" });
        } else {
          // pending — schedule next poll if we have time
          if (Date.now() - start < MAX_POLL_DURATION_MS) {
            setTimeout(poll, POLL_INTERVAL_MS);
          } else {
            setState({
              kind: "failed",
              error: "still_generating",
            });
          }
        }
      } catch {
        // Network blip — try again
        if (Date.now() - start < MAX_POLL_DURATION_MS) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
    // We don't include `state` in deps — it would cause restart loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (state.kind === "missing") {
    return null; // Quietly render nothing — feature might be disabled
  }

  if (state.kind === "loading") {
    return (
      <div className="mt-8 rounded-lg border border-border bg-background p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-brand">
          Personalized analysis
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent"
          />
          <p className="text-sm text-muted">
            Generating your personalized analysis...
          </p>
        </div>
        <p className="mt-2 text-xs text-muted">
          This usually takes 5-15 seconds.
        </p>
      </div>
    );
  }

  if (state.kind === "failed") {
    if (state.error === "still_generating") {
      return (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-xs font-medium uppercase tracking-widest text-amber-800">
            Personalized analysis
          </p>
          <p className="mt-3 text-sm text-amber-900">
            Your personalized analysis is taking longer than expected. Refresh this
            page in a minute to see it.
          </p>
        </div>
      );
    }
    // Genuine failure — don't expose the error string to the visitor.
    return null;
  }

  // Ready
  return (
    <div className="mt-8 rounded-lg border border-border bg-background p-6 sm:p-7">
      <p className="text-xs font-medium uppercase tracking-widest text-brand">
        Personalized analysis
      </p>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-foreground">
        {state.body.split(/\n\n+/).map((para, idx) => (
          <p key={idx}>{para}</p>
        ))}
      </div>
    </div>
  );
}
