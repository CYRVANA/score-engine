"use client";

import { useState } from "react";
import { QuizProgress } from "./QuizProgress";

/**
 * Quiz data types — match the shape returned by the server component.
 * Eventually replaced by auto-generated Supabase types after `npm run db:types`.
 */
export type QuizOption = {
  label: string;
  points: number;
};

export type QuizQuestion = {
  id: string;
  order_index: number;
  type: string;
  prompt: string;
  options: QuizOption[];
};

export type QuizData = {
  id: string;
  title: string;
  description: string | null;
  questions: QuizQuestion[];
};

/**
 * Multi-step quiz renderer.
 *
 * Phase 1.1: client-side state only. No server writes yet.
 * Phase 1.2 will add the scoring Server Action call.
 *
 * State held here:
 *   - currentIndex: which question is on screen (0-based)
 *   - answers: map of question_id -> selected option index
 *
 * Navigation:
 *   - Required answers (current question must have a selection before Next is enabled)
 *   - Previous always enabled except on the first question
 *   - Selecting an option updates state but does NOT auto-advance
 */
export function QuizTaker({ quiz }: { quiz: QuizData }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const totalQuestions = quiz.questions.length;
  const currentQuestion = quiz.questions[currentIndex];
  const currentAnswer = answers[currentQuestion?.id];
  const hasAnsweredCurrent = currentAnswer !== undefined;
  const isLastQuestion = currentIndex === totalQuestions - 1;

  function selectOption(optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionIndex }));
  }

  function goNext() {
    if (!hasAnsweredCurrent) return; // required-answer guard
    if (isLastQuestion) {
      // Phase 1.2 will replace this with a Server Action call.
      setSubmitted(true);
      return;
    }
    setCurrentIndex((i) => i + 1);
  }

  function goPrevious() {
    if (currentIndex === 0) return;
    setCurrentIndex((i) => i - 1);
  }

  // Placeholder completion screen — replaced in Phase 1.2 by the email gate,
  // and in Phase 1.5 by the actual results page redirect.
  if (submitted) {
    return (
      <div className="mx-auto max-w-prose px-6 py-24 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">
          Quiz complete
        </p>
        <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
          You've answered all {totalQuestions} questions.
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-muted">
          The scoring engine and results page land in the next Phase 1 deploy. Your answers
          are currently held in browser state only — nothing has been saved.
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setCurrentIndex(0);
            setAnswers({});
          }}
          className="mt-8 inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-border/40"
        >
          Start over
        </button>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="mx-auto max-w-prose px-6 py-24 text-center">
        <p className="text-muted">This quiz has no questions configured.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-prose px-6 py-16 sm:py-24">
      <QuizProgress current={currentIndex + 1} total={totalQuestions} />

      <h2 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
        {currentQuestion.prompt}
      </h2>

      <fieldset className="mt-8 space-y-3">
        <legend className="sr-only">Answer options for: {currentQuestion.prompt}</legend>
        {currentQuestion.options.map((option, optionIndex) => {
          const isSelected = currentAnswer === optionIndex;
          return (
            <label
              key={optionIndex}
              className={`flex cursor-pointer items-center gap-4 rounded-lg border px-5 py-4 text-base transition ${
                isSelected
                  ? "border-brand bg-brand/5 ring-2 ring-brand"
                  : "border-border hover:border-foreground/30 hover:bg-border/20"
              }`}
            >
              <input
                type="radio"
                name={`question-${currentQuestion.id}`}
                value={optionIndex}
                checked={isSelected}
                onChange={() => selectOption(optionIndex)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                  isSelected ? "border-brand bg-brand" : "border-border bg-background"
                }`}
              >
                {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
              <span className="text-foreground">{option.label}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-10 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={goPrevious}
          disabled={currentIndex === 0}
          className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">←</span>
          Previous
        </button>

        <button
          type="button"
          onClick={goNext}
          disabled={!hasAnsweredCurrent}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand"
        >
          {isLastQuestion ? "Finish" : "Next"}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {!hasAnsweredCurrent && (
        <p className="mt-4 text-right text-xs text-muted">Select an option to continue</p>
      )}
    </main>
  );
}
