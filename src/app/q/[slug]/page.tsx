import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuizTaker, type QuizData, type QuizOption } from "@/components/QuizTaker";
import { startSession } from "./actions";

// Public quiz pages are dynamic now (session per visit), so we can't ISR them.
export const dynamic = "force-dynamic";

/**
 * Public quiz taker page.
 *
 * Phase 1.2: starts a server-side session on every visit, passes the session_id
 * to the client. The client uses it when calling submitQuiz at the end.
 */
export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select(
      `
      id,
      title,
      description,
      questions (
        id,
        order_index,
        type,
        prompt,
        options
      )
    `,
    )
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !quiz) {
    notFound();
  }

  // Start a session row for this visit. If it fails (e.g. DB down), we still
  // render the quiz UI but the client will detect the missing session_id and
  // show an error on submit rather than swallowing the failure silently.
  const sessionResult = await startSession(quiz.id);
  const sessionId = "session_id" in sessionResult ? sessionResult.session_id : null;

  const sortedQuestions = [...(quiz.questions ?? [])]
    .sort((a, b) => a.order_index - b.order_index)
    .map((q) => ({
      ...q,
      options: q.options as QuizOption[],
    }));

  const quizData: QuizData = {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    questions: sortedQuestions,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-prose px-6 py-8 sm:py-10">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-brand">
            CYRVANA Assessment
          </p>
          <h1 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {quizData.title}
          </h1>
          {quizData.description && (
            <p className="mt-3 text-base leading-relaxed text-muted">{quizData.description}</p>
          )}
        </div>
      </header>

      <QuizTaker quiz={quizData} sessionId={sessionId} />
    </div>
  );
}
