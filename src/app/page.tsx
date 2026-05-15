import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-navy-deep text-white">
      {/* Atmospheric gradient backdrop — navy → deeper navy with a single warm accent. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at top right, rgba(236,98,2,0.18), transparent 50%), radial-gradient(ellipse at bottom left, rgba(26,35,50,0.8), transparent 60%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-page flex-col px-6 py-12 sm:px-10 lg:px-16">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-brand" />
            <span className="text-sm font-semibold uppercase tracking-widest text-white/80">
              CYRVANA Assessments
            </span>
          </div>
          <span className="text-xs text-white/40">score-engine · v0.1</span>
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col justify-center py-24">
          <p className="mb-6 text-sm font-medium uppercase tracking-[0.2em] text-brand">
            Phase 0 · Scaffold live
          </p>
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
            Assess. Score. <span className="text-brand">Engage.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl">
            A lead-generation quiz platform purpose-built for CYRVANA — cybersecurity
            readiness assessments that convert browsers into qualified conversations.
          </p>

          <div className="mt-12 flex flex-wrap gap-4">
            <Link
              href="/q/cyber-readiness"
              className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-navy-deep"
            >
              Try the demo quiz
              <span aria-hidden="true">→</span>
            </Link>
            <a
              href="https://cyrvana.com"
              className="inline-flex items-center gap-2 rounded-md border border-white/20 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/5"
            >
              cyrvana.com
            </a>
          </div>
        </section>

        {/* Status grid — what's live, what's next */}
        <section className="grid gap-6 border-t border-white/10 py-12 sm:grid-cols-3">
          <StatusCard label="Phase 0" status="Complete" detail="Repo · DNS · SSL · Theme · Schema" />
          <StatusCard label="Phase 1" status="Next" detail="Public quiz + lead capture" />
          <StatusCard label="Phase 2" status="Planned" detail="Admin UI · HubSpot adapter" />
        </section>

        {/* Footer */}
        <footer className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {new Date().getFullYear()} CYRVANA. All rights reserved.</span>
          <span>
            Built on Next.js + Supabase ·{" "}
            <a href="https://cyrvana.com/privacy" className="underline hover:text-white/70">
              Privacy
            </a>
          </span>
        </footer>
      </div>
    </main>
  );
}

function StatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  const isComplete = status === "Complete";
  const isNext = status === "Next";
  return (
    <div className="rounded-lg border border-white/10 bg-navy/40 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
          {label}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            isComplete
              ? "bg-brand/20 text-brand-200"
              : isNext
                ? "bg-white/10 text-white/80"
                : "bg-white/5 text-white/40"
          }`}
        >
          {status}
        </span>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-white/70">{detail}</p>
    </div>
  );
}
