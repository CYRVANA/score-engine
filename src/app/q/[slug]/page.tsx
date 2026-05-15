import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuizTaker, type QuizData, type QuizOption } from "@/components/QuizTaker";

// ISR: revalidate every 60s. See ARCHITECTURE.md §4.
export const revalidate = 60;

/**
 * Public quiz taker page.
 *
 * Server component: loads the published quiz + its questions from Supabase
 * (anon read, gated by RLS policies in migration 0002), then renders the
 * client-side QuizTaker which owns all interaction state.
 *
 * Phase 1.1: questions render and navigate. No scoring or persistence yet.
 */
export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  // Fetch the quiz and its questions in one round-trip via PostgREST embedding.
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

  // Sort questions by order_index (PostgREST doesn't guarantee order on embeds).
  const sortedQuestions = [...(quiz.questions ?? [])]
    .sort((a, b) => a.order_index - b.order_index)
    .map((q) => ({
      ...q,
      // options arrives as Json from Supabase; cast to our typed shape.
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
      {/* Intro header — shown above the quiz taker on every question */}
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

      <QuizTaker quiz={quizData} />
    </div>
  );
}
