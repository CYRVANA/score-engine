"use client";

import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";

/**
 * Tiny client component just to handle the onChange auto-submit on the
 * quiz picker dropdown. Lifted out because the analytics page itself is
 * a server component and can't have inline onChange handlers.
 */
export function QuizPicker({
  quizzes,
  currentQuizId,
}: {
  quizzes: Array<{ id: string; title: string }>;
  currentQuizId: string;
}) {
  const router = useRouter();

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.currentTarget.value;
    router.push(`/admin/analytics?quiz=${next}`);
  }

  return (
    <select
      id="quiz-picker"
      defaultValue={currentQuizId}
      onChange={handleChange}
      className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
    >
      {quizzes.map((q) => (
        <option key={q.id} value={q.id}>
          {q.title}
        </option>
      ))}
    </select>
  );
}
