"use client";

/**
 * Coverage analysis box. Pure client component — takes questions + tiers
 * as props and computes the achievable score range and coverage warnings
 * inline so it can update in real time as the editors mutate state.
 *
 * Logic mirrors the server-side version that lives on the read-only page;
 * we duplicate intentionally because the editors hold local in-memory state.
 */

import { useMemo } from "react";

export type CoverageQuestion = {
  weight: number;
  options: Array<{ points: number }>;
};
export type CoverageTier = {
  min_score: number;
  max_score: number;
  title: string;
};

export function CoverageBox({
  questions,
  tiers,
}: {
  questions: CoverageQuestion[];
  tiers: CoverageTier[];
}) {
  const report = useMemo(() => analyzeCoverage(questions, tiers), [questions, tiers]);

  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Fact label="Min possible score" value={report.minPossible.toString()} />
        <Fact label="Max possible score" value={report.maxPossible.toString()} />
        <Fact
          label="Coverage"
          value={report.fullyCovered ? "Complete" : "Has gaps"}
          accent={report.fullyCovered ? "good" : "warn"}
        />
      </div>

      {report.warnings.length > 0 && (
        <ul className="mt-5 space-y-2">
          {report.warnings.map((w, idx) => (
            <li
              key={idx}
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <span className="font-semibold">Note:</span> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "warn";
}) {
  const valueClass =
    accent === "good"
      ? "text-brand"
      : accent === "warn"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-1.5 text-lg font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

type CoverageReport = {
  minPossible: number;
  maxPossible: number;
  fullyCovered: boolean;
  warnings: string[];
};

function analyzeCoverage(
  questions: CoverageQuestion[],
  tiers: CoverageTier[],
): CoverageReport {
  if (questions.length === 0) {
    return {
      minPossible: 0,
      maxPossible: 0,
      fullyCovered: tiers.length > 0,
      warnings:
        tiers.length === 0
          ? ["No questions and no tiers yet. Add both before publishing."]
          : ["No questions yet. Tiers will never be matched."],
    };
  }

  let minPossible = 0;
  let maxPossible = 0;
  for (const q of questions) {
    if (q.options.length === 0) continue;
    const points = q.options.map((o) => o.points * (q.weight ?? 1));
    minPossible += Math.min(...points);
    maxPossible += Math.max(...points);
  }

  const warnings: string[] = [];

  if (tiers.length === 0) {
    warnings.push(
      `Achievable scores are ${minPossible}–${maxPossible}, but no tiers are defined.`,
    );
    return { minPossible, maxPossible, fullyCovered: false, warnings };
  }

  const uncovered: number[] = [];
  for (let s = minPossible; s <= maxPossible; s++) {
    const covered = tiers.some((t) => s >= t.min_score && s <= t.max_score);
    if (!covered) uncovered.push(s);
  }
  if (uncovered.length > 0) {
    warnings.push(
      uncovered.length <= 10
        ? `Scores ${uncovered.join(", ")} fall outside any tier.`
        : `${uncovered.length} possible scores (e.g. ${uncovered.slice(0, 5).join(", ")}...) fall outside any tier.`,
    );
  }

  for (const t of tiers) {
    if (t.max_score < minPossible)
      warnings.push(
        `Tier "${t.title}" (${t.min_score}–${t.max_score}) is below the achievable minimum (${minPossible}) — it can never match.`,
      );
    if (t.min_score > maxPossible)
      warnings.push(
        `Tier "${t.title}" (${t.min_score}–${t.max_score}) is above the achievable maximum (${maxPossible}) — it can never match.`,
      );
  }
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i];
      const b = tiers[j];
      if (a.min_score <= b.max_score && b.min_score <= a.max_score)
        warnings.push(
          `Tiers "${a.title}" and "${b.title}" overlap — scores in the overlap get the first-matched tier.`,
        );
    }
  }

  return {
    minPossible,
    maxPossible,
    fullyCovered: uncovered.length === 0 && warnings.length === 0,
    warnings,
  };
}
