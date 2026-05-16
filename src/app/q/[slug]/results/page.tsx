import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Force dynamic — each session is unique, no point caching.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ s?: string }>;
type RouteParams = Promise<{ slug: string }>;

type AnswerWithQuestion = {
  points: number;
  value: { option_index: number; option_label: string } | null;
  questions:
    | { prompt: string; order_index: number }
    | { prompt: string; order_index: number }[]
    | null;
};

/**
 * Public results page at /q/[slug]/results?s=<session_id>.
 *
 * The session ID is a v4 UUID (122 bits of randomness) — effectively
 * unguessable. We don't show PII (email/name) on the page, so even shared
 * URLs are safe to circulate.
 */
export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { s: sessionId } = await searchParams;

  if (!sessionId) {
    notFound();
  }

  const supabase = await createClient();

  // Fetch the session with embedded quiz + tier + answers (one round-trip).
  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      `
      id,
      score,
      completed_at,
      quizzes:quiz_id (
        id,
        slug,
        title
      ),
      result_tiers:result_tier_id (
        id,
        title,
        description,
        cta_label,
        cta_url,
        min_score,
        max_score
      ),
      answers (
        points,
        value,
        questions:question_id (
          prompt,
          order_index
        )
      )
    `,
    )
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    notFound();
  }

  // Validate the slug in the URL matches the session's actual quiz.
  // Prevents random session UUIDs being viewed at the wrong slug.
  // Supabase embed types as a single object, but TypeScript widens it to array
  // in some configurations; handle both shapes defensively.
  const quiz = Array.isArray(session.quizzes) ? session.quizzes[0] : session.quizzes;
  const tier = Array.isArray(session.result_tiers)
    ? session.result_tiers[0]
    : session.result_tiers;

  if (!quiz || quiz.slug !== slug) {
    notFound();
  }

  if (!session.completed_at) {
    notFound();
  }

// Normalize the embedded question shape — Supabase types `questions` as
  // an array on this embed; collapse to a single object for easier rendering.
  const sortedAnswers = ((session.answers ?? []) as AnswerWithQuestion[])
    .map((a) => ({
      points: a.points,
      value: a.value,
      question: Array.isArray(a.questions) ? a.questions[0] : a.questions,
    }))
    .filter((a) => a.question !== null && a.question !== undefined)
    .sort((a, b) => (a.question!.order_index ?? 0) - (b.question!.order_index ?? 0));

  return (
    <div className="min-h-screen bg-background">
      <pre className="m-4 max-w-prose overflow-auto rounded bg-yellow-100 p-4 text-xs">
           {JSON.stringify({
             url_slug: slug,
             quiz_resolved: quiz,
             tier_resolved: tier,
             completed_at: session.completed_at,
           }, null, 2)}
         </pre>
      <div className="mx-auto max-w-prose px-6 py-12 sm:py-16">
        {/* Hero — score + tier */}
        <header className="text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-brand">
            Your CYRVANA Assessment Result
          </p>
          <h1 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {quiz.title}
          </h1>
        </header>

        {/* Score card */}
        <div className="mt-10 rounded-lg border border-border bg-navy-deep p-8 text-white shadow-sm sm:p-10">
          {tier ? (
            <>
              <p className="text-xs font-medium uppercase tracking-widest text-brand">
                Tier
              </p>
              <h2 className="mt-2 text-4xl font-bold leading-tight sm:text-5xl">
                {tier.title}
              </h2>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-brand">{session.score}</span>
                <span className="text-base text-white/60">points</span>
              </div>
              <p className="mt-6 text-base leading-relaxed text-white/85">
                {tier.description}
              </p>
              {tier.cta_url && tier.cta_label && (
                <a
                  href={tier.cta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600"
                >
                  {tier.cta_label}
                  <span aria-hidden="true">→</span>
                </a>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-widest text-brand">
                Score
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-bold text-brand">{session.score}</span>
                <span className="text-base text-white/60">points</span>
              </div>
              <p className="mt-6 text-base leading-relaxed text-white/85">
                Your score has been recorded. A more detailed result tier wasn't
                configured for this score range.
              </p>
            </>
          )}
        </div>

        {/* Answer breakdown */}
        {sortedAnswers.length > 0 && (
          <section className="mt-12">
            <h3 className="text-xl font-bold text-foreground">Your answers</h3>
            <p className="mt-2 text-sm text-muted">
              Here&apos;s what you said. Use this as a starting point for the
              conversation with your team.
            </p>
            <ol className="mt-6 space-y-4">
              {sortedAnswers.map((answer, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border bg-background p-5"
                >
                  <p className="text-xs font-medium uppercase tracking-widest text-muted">
                    Question {idx + 1}
                  </p>
                  <p className="mt-2 text-base font-semibold text-foreground">
                    {answer.question?.prompt}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-sm leading-relaxed text-muted">
                      {answer.value?.option_label ?? "(no selection)"}
                    </p>
                    <span className="flex-shrink-0 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-700">
                      {answer.points} pt{answer.points === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Footer actions */}
        <footer className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8 text-center">
          <p className="text-sm text-muted">Want to retake the assessment?</p>
          <Link
            href={`/q/${slug}`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-border/30"
          >
            Take it again
            <span aria-hidden="true">→</span>
          </Link>
          <p className="mt-4 text-xs text-muted">
            <Link href="https://cyrvana.com" className="hover:text-foreground">
              cyrvana.com
            </Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
