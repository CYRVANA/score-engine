"use client";

import { useState, useTransition } from "react";
import { QuizProgress } from "./QuizProgress";
import { EmailGate, type LeadFormData } from "./EmailGate";
import { submitQuiz } from "@/app/q/[slug]/actions";

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
 * Quiz states, in order:
 *   idle       — user is answering questions
 *   submitting — submitQuiz Server Action in flight
 *   gated      — score saved; waiting for email + name + consent
 *   capturing  — lead capture Server Action in flight (Phase 1.4 wires this up)
 *   done       — placeholder result card shown
 *   error      — something failed
 */
type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "gated"; score: number; tier_title: string | null }
  | { kind: "capturing"; score: number; tier_title: string | null }
  | { kind: "done"; score: number; tier_title: string | null }
  | { kind: "error"; message: string };

export function QuizTaker({
  quiz,
  sessionId,
}: {
  quiz: QuizData;
  sessionId: string | null;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const totalQuestions = quiz.questions.length;
  const currentQuestion = quiz.questions[currentIndex];
  const currentAnswer = answers[currentQuestion?.id];
  const hasAnsweredCurrent = currentAnswer !== undefined;
  const isLastQuestion = currentIndex === totalQuestions - 1;

  function selectOption(optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionIndex }));
  }

  function goNext() {
    if (!hasAnsweredCurrent) return;
    if (isLastQuestion) {
      handleFinish();
      return;
    }
    setCurrentIndex((i) => i + 1);
  }

  function goPrevious() {
    if (currentIndex === 0) return;
    setCurrentIndex((i) => i - 1);
  }

  function handleFinish() {
    if (!sessionId) {
      setSubmitState({
        kind: "error",
        message: "This session didn't initialize correctly. Please refresh and try again.",
      });
      return;
    }

    const submissions = Object.entries(answers).map(([question_id, option_index]) => ({
      question_id,
      option_index,
    }));

    setSubmitState({ kind: "submitting" });
    startTransition(async () => {
      const result = await submitQuiz(sessionId, quiz.id, submissions);
      if (result.ok) {
        // Phase 1.3: gate before showing results.
        setSubmitState({
          kind: "gated",
          score: result.score,
          tier_title: result.result_tier?.title ?? null,
        });
      } else {
        setSubmitState({ kind: "error", message: result.error });
      }
    });
  }

  function handleGateSubmit(data: LeadFormData) {
    // Phase 1.3 placeholder: client-side honeypot check, then advance.
    // Phase 1.4 will replace this with a captureLead Server Action call.
    if (data.honeypot) {
      // Pretend success — never let bots know they were detected.
      // (In Phase 1.4 we'll log this attempt server-side.)
      if (submitState.kind !== "gated") return;
      setSubmitState({
        kind: "done",
        score: submitState.score,
        tier_title: submitState.tier_title,
      });
      return;
    }

    if (submitState.kind !== "gated") return;

    // Brief simulated delay so the spinner is visible; piece 4 will replace
    // this with the actual Server Action latency.
    setSubmitState({
      kind: "capturing",
      score: submitState.score,
      tier_title: submitState.tier_title,
    });
    const captured = { score: submitState.score, tier_title: submitState.tier_title };
    setTimeout(() => {
      setSubmitState({
        kind: "done",
        score: captured.score,
        tier_title: captured.tier_title,
      });
    }, 600);
  }

  // --- Render: submitting state ---
  if (submitState.kind === "submitting" || isPending) {
    return (
      <main className="mx-auto max-w-prose px-6 py-24 text-center">
        <div className="inline-flex items-center gap-3">
          <div
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent"
          />
          <p className="text-base text-muted">Calculating your result...</p>
        </div>
      </main>
    );
  }

  // --- Render: email gate ---
  if (submitState.kind === "gated" || submitState.kind === "capturing") {
    return (
      <EmailGate
        score={submitState.score}
        onSubmit={handleGateSubmit}
        isPending={submitState.kind === "capturing"}
      />
    );
  }

  // --- Render: done state (placeholder results card) ---
  if (submitState.kind === "done") {
    return (
      <main className="mx-auto max-w-prose px-6 py-16 sm:py-24">
        <div className="rounded-lg border border-border bg-background p-8 shadow-sm sm:p-10">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-brand">
            Your result
          </p>
          <h2 className="text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {submitState.tier_title ?? "Result"}
          </h2>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-5xl font-bold text-brand">{submitState.score}</span>
            <span className="text-base text-muted">points</span>
          </div>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            <strong className="text-foreground">Phase 1.3 placeholder.</strong> Lead
            capture wires up in piece 4; the full results page (tier description, CTA,
            etc.) lands in piece 5. Your score is saved; your email is not yet.
          </p>
        </div>
      </main>
    );
  }

  // --- Render: error state ---
  if (submitState.kind === "error") {
    return (
      <main className="mx-auto max-w-prose px-6 py-24 text-center">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-brand">
          Something went wrong
        </p>
        <h2 className="text-2xl font-bold text-foreground">{submitState.message}</h2>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          Refresh and try again
        </button>
      </main>
    );
  }

  // --- Render: question state (default) ---
  if (!currentQuestion) {
    return (
      <main className="mx-auto max-w-prose px-6 py-24 text-center">
        <p className="text-muted">This quiz has no questions configured.</p>
      </main>
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
