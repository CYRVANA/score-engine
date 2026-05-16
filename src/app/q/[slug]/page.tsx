import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuizTaker, type QuizData, type QuizOption } from "@/components/QuizTaker";
import { startSession } from "./actions";

export const dynamic = "force-dynamic";

export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select(
      `
      id,
      slug,
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
    slug: quiz.slug,
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
