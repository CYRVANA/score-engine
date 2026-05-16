import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ s?: string }>;
type RouteParams = Promise<{ slug: string }>;

/**
 * TEMPORARY DEBUG VERSION. Shows raw data shapes on-page.
 * Revert to clean version once we've identified which check is failing.
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
    return (
      <pre className="m-4 max-w-3xl overflow-auto rounded bg-yellow-100 p-4 text-xs">
        DEBUG: No session ID in URL.{"\n"}
        URL slug: {slug}
      </pre>
    );
  }

  const supabase = await createClient();

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
        cta_url
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

  return (
    <main className="min-h-screen bg-background p-6">
      <pre className="mb-6 max-w-3xl overflow-auto rounded bg-yellow-100 p-4 text-xs">
        {JSON.stringify(
          {
            url_slug: slug,
            session_id: sessionId,
            error_message: error?.message ?? null,
            error_code: error?.code ?? null,
            session_loaded: !!session,
            session_completed_at: session?.completed_at ?? null,
            session_score: session?.score ?? null,
            quizzes_field_type: Array.isArray(session?.quizzes)
              ? "array"
              : typeof session?.quizzes,
            quizzes_field_value: session?.quizzes ?? null,
            result_tiers_field_type: Array.isArray(session?.result_tiers)
              ? "array"
              : typeof session?.result_tiers,
            result_tiers_field_value: session?.result_tiers ?? null,
            answers_count: session?.answers?.length ?? 0,
            first_answer_question_field_type:
              session?.answers && session.answers.length > 0
                ? Array.isArray(
                    (session.answers[0] as { questions?: unknown }).questions,
                  )
                  ? "array"
                  : typeof (session.answers[0] as { questions?: unknown }).questions
                : null,
            first_answer_question_field_value:
              session?.answers && session.answers.length > 0
                ? (session.answers[0] as { questions?: unknown }).questions
                : null,
          },
          null,
          2,
        )}
      </pre>
      <Link href="/" className="text-brand underline">
        Back to home
      </Link>
    </main>
  );
}
