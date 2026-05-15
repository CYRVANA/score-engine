import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ISR: revalidate every 60s. See ARCHITECTURE.md §4.
export const revalidate = 60;

/**
 * Public quiz taker page. Phase 0: minimal "we found your quiz" stub.
 * Phase 1 will replace the body with:
 *   - Multi-step question renderer (client component)
 *   - Score computation in a Server Action
 *   - Email gate before /results
 */
export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select("id, title, description")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !quiz) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-prose px-6 py-24">
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">
        Assessment
      </p>
      <h1 className="text-4xl font-bold leading-tight text-foreground sm:text-5xl">
        {quiz.title}
      </h1>
      {quiz.description && (
        <p className="mt-6 text-lg leading-relaxed text-muted">{quiz.description}</p>
      )}

      <div className="mt-12 rounded-lg border border-border bg-navy-deep p-6 text-white/80">
        <p className="text-sm">
          <strong className="text-brand">Phase 0 scaffold.</strong> The question renderer
          and scoring logic land in Phase 1. The quiz is real (seeded in Supabase), and
          this page successfully read it through RLS — that confirms the stack is wired
          up correctly end-to-end.
        </p>
      </div>
    </main>
  );
}
