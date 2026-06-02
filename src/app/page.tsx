import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { brand } from "@/lib/brand";

//export const dynamic = "force-dynamic";
export const revalidate = 60;

/**
 * Public landing page.
 *
 * Lists all published quizzes. Falls back to a single CTA for one quiz,
 * a card grid for multiple, a "coming soon" stub for zero.
 * All brand strings come from env vars via brand config — never hardcoded.
 */
export default async function HomePage() {
  const supabase = createServiceRoleClient();

  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, title, slug, description")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  const published = quizzes ?? [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-navy-deep text-white">
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
              {brand.name}
            </span>
          </div>
          {brand.websiteUrl && (
            <a
              href={brand.websiteUrl}
              className="text-xs text-white/40 transition hover:text-white/70"
            >
              {brand.websiteUrl.replace(/^https?:\/\//, "")} →
            </a>
          )}
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col justify-center py-20">
          <p className="mb-6 text-sm font-medium uppercase tracking-[0.2em] text-brand">
            Free Assessment
          </p>
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
            <span className="text-brand">{brand.tagline}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl">
            Take a free assessment and get a personalized analysis — in under five minutes.
          </p>

          {published.length === 1 && (
            <div className="mt-10">
              <Link
                href={`/q/${published[0].slug}`}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-8 py-4 text-base font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-navy-deep"
              >
                {published[0].title}
                <span aria-hidden="true">→</span>
              </Link>
              {published[0].description && (
                <p className="mt-3 text-sm text-white/50">{published[0].description}</p>
              )}
            </div>
          )}

          {published.length === 0 && (
            <p className="mt-10 text-sm text-white/40">Assessments coming soon.</p>
          )}
        </section>

        {/* Quiz grid — shown when there are multiple published quizzes */}
        {published.length > 1 && (
          <section className="border-t border-white/10 py-12">
            <h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-white/50">
              Available assessments
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {published.map((quiz) => (
                <Link
                  key={quiz.id}
                  href={`/q/${quiz.slug}`}
                  className="group rounded-lg border border-white/10 bg-navy/40 p-6 backdrop-blur transition hover:border-brand/40 hover:bg-navy/60"
                >
                  <h3 className="font-semibold text-white group-hover:text-brand">
                    {quiz.title}
                  </h3>
                  {quiz.description && (
                    <p className="mt-2 text-sm leading-relaxed text-white/60">
                      {quiz.description}
                    </p>
                  )}
                  <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-brand/70 group-hover:text-brand">
                    Start assessment →
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Trust line */}
        <section className="border-t border-white/10 py-8">
          <p className="text-xs leading-relaxed text-white/30">
            Assessments are free. Your results include a scored tier, a breakdown of your
            answers, and a personalized analysis. No sales call required to see your results.
          </p>
        </section>

        {/* Footer */}
        <footer className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {new Date().getFullYear()} {brand.name}. All rights reserved.</span>
          <span className="flex items-center gap-3">
            {brand.privacyUrl && (
              <a href={brand.privacyUrl} className="underline hover:text-white/70">
                Privacy
              </a>
            )}
            {brand.websiteUrl && (
              <a href={brand.websiteUrl} className="hover:text-white/70">
                {brand.websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </span>
        </footer>
      </div>
    </main>
  );
}
