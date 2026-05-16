"use client";

import { useState, type FormEvent } from "react";

export type LeadFormData = {
  email: string;
  name: string;
  consent: boolean;
  // Honeypot field — must be empty on submit. Anything else = bot.
  // We send it to the server anyway so piece 4 can log abuse attempts.
  honeypot: string;
};

type EmailGateProps = {
  score: number;
  onSubmit: (data: LeadFormData) => void;
  isPending: boolean;
};

/**
 * Email gate shown between quiz completion and results.
 *
 * Phase 1.3: UI only. The onSubmit callback hands form data back to the parent
 * (QuizTaker), which today just unlocks the placeholder result card. Phase 1.4
 * will replace that callback with a Server Action that saves the lead.
 *
 * Design choices (per the Phase 1.3 decisions):
 *  - Score preview: shown
 *  - Tier title: hidden (creates the curiosity hook)
 *  - Required fields: email + name + consent checkbox
 *  - Honeypot: CSS-hidden field; bots fill it, humans don't
 */
export function EmailGate({ score, onSubmit, isPending }: EmailGateProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Client-side email format check. Server will re-validate.
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError(null);

    onSubmit({
      email: trimmedEmail,
      name: name.trim(),
      consent,
      honeypot,
    });
  }

  return (
    <main className="mx-auto max-w-prose px-6 py-16 sm:py-24">
      <div className="rounded-lg border border-border bg-background p-8 shadow-sm sm:p-10">
        {/* Score preview — withholds tier to create curiosity */}
        <div className="mb-8 border-b border-border pb-6 text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-brand">
            Assessment complete
          </p>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-5xl font-bold text-foreground">{score}</span>
            <span className="text-base text-muted">points</span>
          </div>
        </div>

        <h2 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
          Get your personalized result
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Your readiness tier, a breakdown of what your score means, and
          recommendations tailored to your answers — sent to your inbox and shown on the
          next screen.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          {/* Honeypot — CSS-hidden, off-screen, with attributes that flag it
              to password managers and screen readers to leave it alone */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-9999px",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label htmlFor="company-website">
              Company website (leave blank)
              <input
                type="text"
                id="company-website"
                name="company-website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </label>
          </div>

          <div>
            <label
              htmlFor="lead-name"
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Your name <span className="text-brand">*</span>
            </label>
            <input
              id="lead-name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={isPending}
              className="w-full rounded-md border border-border bg-background px-4 py-3 text-base text-foreground transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label
              htmlFor="lead-email"
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Work email <span className="text-brand">*</span>
            </label>
            <input
              id="lead-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              autoComplete="email"
              disabled={isPending}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              className={`w-full rounded-md border bg-background px-4 py-3 text-base text-foreground transition focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60 ${
                emailError
                  ? "border-red-500 focus:border-red-500"
                  : "border-border focus:border-brand"
              }`}
              placeholder="jane@company.com"
            />
            {emailError && (
              <p id="email-error" className="mt-2 text-sm text-red-600">
                {emailError}
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-border/10 p-4 transition hover:bg-border/20">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={isPending}
              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-brand"
            />
            <span className="text-sm leading-relaxed text-foreground">
              I agree to receive my assessment results and occasional cybersecurity
              insights from CYRVANA. I can unsubscribe at any time.{" "}
              <a
                href="https://cyrvana.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand underline-offset-2 hover:underline"
              >
                Privacy policy
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={isPending || !email || !name || !consent}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-6 py-3.5 text-base font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand"
          >
            {isPending ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                />
                Saving...
              </>
            ) : (
              <>
                Show my results
                <span aria-hidden="true">→</span>
              </>
            )}
          </button>

          <p className="text-center text-xs text-muted">
            We respect your inbox. Your details are never sold or shared.
          </p>
        </form>
      </div>
    </main>
  );
}
