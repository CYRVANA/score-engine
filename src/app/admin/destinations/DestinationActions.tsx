"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setDestinationActive,
  deleteDestination,
  retryDelivery,
} from "./actions";

export function DestinationToggleActive({
  destId,
  isActive,
}: {
  destId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await setDestinationActive(destId, !isActive);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
          isActive
            ? "border-amber-200 bg-background text-amber-800 hover:bg-amber-50"
            : "border-brand/30 bg-background text-brand hover:bg-brand/10"
        }`}
      >
        {isPending ? "..." : isActive ? "Deactivate" : "Activate"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function DestinationDeleteButton({ destId }: { destId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDestination(destId);
      if (!result.ok) setError(result.error);
      else router.push("/admin/destinations");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        className="rounded-md border border-red-200 bg-background px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
      >
        Delete
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setConfirming(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
            <h3 className="text-lg font-bold text-foreground">Delete this destination?</h3>
            <p className="mt-2 text-sm text-foreground">
              Removes the destination and all its delivery history. Leads themselves
              are unaffected — only the routing config is deleted.
            </p>
            <p className="mt-2 text-sm text-muted">This cannot be undone.</p>

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const result = await retryDelivery(deliveryId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleRetry}
        disabled={isPending}
        className="rounded-md border border-brand/30 bg-background px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-60"
      >
        {isPending ? "Retrying..." : "Retry"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </>
  );
}
