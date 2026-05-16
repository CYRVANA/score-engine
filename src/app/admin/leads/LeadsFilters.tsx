"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";

type QuizForFilter = {
  id: string;
  title: string;
  slug: string;
};

/**
 * Filter and search controls for the leads table.
 *
 * Reads current state from the URL and pushes new state via router.push,
 * so back/forward and bookmarking work naturally.
 */
export function LeadsFilters({
  quizzes,
  currentQuizId,
  currentSearch,
}: {
  quizzes: QuizForFilter[];
  currentQuizId: string | null;
  currentSearch: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(currentSearch);
  const [isPending, startTransition] = useTransition();

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    // Reset to page 1 whenever the filter changes — staying on page 7 of an
    // empty filter result would be confusing.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/leads?${qs}` : "/admin/leads");
    });
  }

  function handleQuizChange(e: ChangeEvent<HTMLSelectElement>) {
    pushParams({ quiz: e.target.value === "all" ? null : e.target.value });
  }

  function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    pushParams({ q: searchValue.trim() || null });
  }

  function handleClear() {
    setSearchValue("");
    pushParams({ q: null });
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label
          htmlFor="quiz-filter"
          className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted"
        >
          Quiz
        </label>
        <select
          id="quiz-filter"
          value={currentQuizId ?? "all"}
          onChange={handleQuizChange}
          disabled={isPending}
          className="min-w-[200px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
        >
          <option value="all">All quizzes</option>
          {quizzes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[240px]">
        <label
          htmlFor="search"
          className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted"
        >
          Search by email
        </label>
        <div className="flex gap-2">
          <input
            id="search"
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="e.g. cyrvana.com"
            disabled={isPending}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            Apply
          </button>
          {currentSearch && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isPending}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-border/30 disabled:opacity-60"
            >
              Clear
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
