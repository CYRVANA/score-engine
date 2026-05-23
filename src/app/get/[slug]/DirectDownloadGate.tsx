"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { captureDirectLead } from "./actions";
import { brand } from "@/lib/brand";

export function DirectDownloadGate({
  documentId,
  documentSlug,
  documentTitle,
  documentDescription,
}: {
  documentId: string;
  documentSlug: string;
  documentTitle: string;
  documentDescription: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!consent) {
      setError("Please accept the terms to continue.");
      return;
    }

    startTransition(async () => {
      const result = await captureDirectLead({
        document_id: documentId,
        email,
        name,
        honeypot,
        consent,
      });

      if (result.ok) {
        router.push(
          `/get/${documentSlug}/download?s=${result.lead_id}&d=${documentId}`,
        );
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Honeypot — hidden from real users */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="dl-name"
            className="mb-1.5 block text-sm font-semibold text-foreground"
          >
            Name
          </label>
          <input
            id="dl-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="Your name"
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </div>
        <div>
          <label
            htmlFor="dl-email"
            className="mb-1.5 block text-sm font-semibold text-foreground"
          >
            Work email <span className="text-brand">*</span>
          </label>
          <input
            id="dl-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            placeholder="you@company.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-border bg-background p-4">
        <input
          id="dl-consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={isPending}
          className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-brand"
        />
        <label
          htmlFor="dl-consent"
          className="cursor-pointer text-sm leading-relaxed text-foreground"
        >
          I agree to receive this resource and occasional updates from {brand.name}.
          I can unsubscribe at any time.{" "}
          {brand.privacyUrl ? (
            <a
              href={brand.privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand underline-offset-2 hover:underline"
            >
              Privacy policy
            </a>
          ) : (
            <span className="text-muted">See our privacy policy.</span>
          )}
          .
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || !email || !consent}
        className="w-full rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
      >
        {isPending ? "Preparing your download..." : `Get ${documentTitle}`}
      </button>
    </form>
  );
}
