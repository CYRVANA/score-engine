/**
 * Analytics data layer.
 *
 * Computes the funnel metrics shown on /admin/analytics. Runs all queries
 * live against Supabase — no caching, no materialized views, no rollup jobs.
 * Fine at small-enterprise scale. Revisit if a single quiz crosses ~50k sessions.
 *
 * All metrics are scoped to a single quiz and a 30-day lookback window.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";

const LOOKBACK_DAYS = 30;

export type QuizSummary = {
  id: string;
  title: string;
  slug: string;
};

export type TierForAnalytics = {
  id: string;
  title: string;
  min_score: number;
  max_score: number;
};

export type AnalyticsReport = {
  // Headline counts (30-day window).
  views: number;
  completions: number;
  captures: number;

  // Rates as fractions 0..1.
  completion_rate: number; // completions / views
  capture_rate: number; // captures / completions
  overall_conversion: number; // captures / views

  // Score distribution bucketed by tier ranges. Always one bucket per tier,
  // plus a special "uncovered" bucket for scores that don't match any tier.
  score_distribution: Array<{
    label: string;
    range: string;
    count: number;
    color_hint: "brand" | "muted" | "amber";
  }>;

  // 30-day trend of daily lead captures.
  daily_captures: Array<{
    date: string; // ISO date "YYYY-MM-DD"
    count: number;
  }>;

  // Recent activity.
  recent_leads: Array<{
    id: string;
    email: string;
    name: string | null;
    captured_at: string;
    score: number | null;
    tier_title: string | null;
  }>;
};

/**
 * List all quizzes in the admin's workspace for the picker dropdown.
 * Includes archived quizzes (admin might still want to look at past data).
 */
export async function listQuizzesForAnalytics(
  workspaceId: string,
): Promise<QuizSummary[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, title, slug")
    .eq("workspace_id", workspaceId)
    .order("title");

  if (error || !data) return [];
  return data;
}

/**
 * Pick the default quiz to show first: the one with the most lead captures
 * in the last 30 days. Falls back to alphabetical-first if no captures recently.
 */
export async function pickDefaultQuiz(
  workspaceId: string,
): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const cutoff = daysAgoIso(LOOKBACK_DAYS);

  const { data } = await supabase
    .from("leads")
    .select("quiz_id")
    .eq("workspace_id", workspaceId)
    .gte("captured_at", cutoff);

  if (data && data.length > 0) {
    // Most frequent quiz_id wins.
    const counts: Record<string, number> = {};
    for (const lead of data) {
      counts[lead.quiz_id] = (counts[lead.quiz_id] ?? 0) + 1;
    }
    let topQuizId: string | null = null;
    let topCount = 0;
    for (const [qid, c] of Object.entries(counts)) {
      if (c > topCount) {
        topCount = c;
        topQuizId = qid;
      }
    }
    if (topQuizId) return topQuizId;
  }

  // Fallback: first alphabetical quiz in this workspace.
  const { data: firstQuiz } = await supabase
    .from("quizzes")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("title")
    .limit(1)
    .maybeSingle();
  return firstQuiz?.id ?? null;
}

/**
 * Compute the full analytics report for a quiz.
 *
 * Pulls four queries in parallel: sessions (views + completions + scores),
 * leads (captures + daily trend + recent), tiers (for distribution bucketing).
 * Aggregation happens in JS — simpler than SQL group-bys and totally fast enough.
 */
export async function computeAnalytics(
  workspaceId: string,
  quizId: string,
): Promise<AnalyticsReport> {
  const supabase = createServiceRoleClient();
  const cutoff = daysAgoIso(LOOKBACK_DAYS);

  // Pull everything needed in parallel.
  const [sessionsResult, leadsResult, tiersResult] = await Promise.all([
    // Sessions in this quiz in the lookback window — includes scores for completed ones.
    supabase
      .from("sessions")
      .select("id, completed_at, score")
      .eq("quiz_id", quizId)
      .gte("started_at", cutoff),

    // Leads in this quiz in the lookback window.
    supabase
      .from("leads")
      .select(
        `
        id, email, name, captured_at,
        sessions:session_id ( score, result_tiers:result_tier_id ( title ) )
      `,
      )
      .eq("workspace_id", workspaceId)
      .eq("quiz_id", quizId)
      .gte("captured_at", cutoff)
      .order("captured_at", { ascending: false }),

    // All tiers for this quiz (not lookback-windowed — they're config, not events).
    supabase
      .from("result_tiers")
      .select("id, title, min_score, max_score")
      .eq("quiz_id", quizId)
      .order("min_score"),
  ]);

  const sessions = sessionsResult.data ?? [];
  const leads = leadsResult.data ?? [];
  const tiers: TierForAnalytics[] = tiersResult.data ?? [];

  const views = sessions.length;
  const completions = sessions.filter((s) => s.completed_at !== null).length;
  const captures = leads.length;

  // Score distribution: one bucket per tier, plus an "uncovered" bucket.
  const tierCounts: number[] = tiers.map(() => 0);
  let uncoveredCount = 0;
  for (const s of sessions) {
    if (s.score === null || s.completed_at === null) continue;
    let matched = false;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (s.score >= t.min_score && s.score <= t.max_score) {
        tierCounts[i] += 1;
        matched = true;
        break;
      }
    }
    if (!matched) uncoveredCount += 1;
  }

  const score_distribution: AnalyticsReport["score_distribution"] = tiers.map(
    (t, i) => ({
      label: t.title,
      range: `${t.min_score}–${t.max_score}`,
      count: tierCounts[i],
      color_hint: "brand" as const,
    }),
  );
  if (uncoveredCount > 0) {
    score_distribution.push({
      label: "Uncovered",
      range: "no tier match",
      count: uncoveredCount,
      color_hint: "amber" as const,
    });
  }

  // Daily lead captures over the lookback window.
  const daily_captures = buildDailySeries(leads, LOOKBACK_DAYS);

  // Recent leads — first 10.
  const recent_leads: AnalyticsReport["recent_leads"] = leads
    .slice(0, 10)
    .map((l) => {
      const session = Array.isArray(l.sessions) ? l.sessions[0] : l.sessions;
      const tier = session
        ? Array.isArray(session.result_tiers)
          ? session.result_tiers[0]
          : session.result_tiers
        : null;
      return {
        id: l.id,
        email: l.email,
        name: l.name,
        captured_at: l.captured_at,
        score: session?.score ?? null,
        tier_title: tier?.title ?? null,
      };
    });

  return {
    views,
    completions,
    captures,
    completion_rate: safeDivide(completions, views),
    capture_rate: safeDivide(captures, completions),
    overall_conversion: safeDivide(captures, views),
    score_distribution,
    daily_captures,
    recent_leads,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/**
 * Build a daily count array for the last N days, filled in for missing days
 * so the chart has consistent x-axis spacing.
 */
function buildDailySeries(
  leads: Array<{ captured_at: string }>,
  days: number,
): Array<{ date: string; count: number }> {
  // Bucket by YYYY-MM-DD in UTC. Using UTC keeps day boundaries stable
  // across timezones — admin's local-time view is built in the chart component.
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const day = lead.captured_at.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }

  const series: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().slice(0, 10);
    series.push({ date: iso, count: counts[iso] ?? 0 });
  }
  return series;
}

// ============================================================================
// Document download analytics (Phase 3c)
// ============================================================================

export type DocumentDownloadStat = {
  document_id: string;
  title: string;
  slug: string;
  total: number;
  gated: number;
  anonymous: number;
};

export type DownloadSourceStat = {
  source: string;
  count: number;
};

export type DocumentDownloadReport = {
  totalDownloads: number;
  totalAnonymous: number;
  totalGated: number;
  byDocument: DocumentDownloadStat[];
  bySource: DownloadSourceStat[];
  windowDays: number;
};

/**
 * Compute workspace-wide document download analytics over a lookback window.
 *
 * Unlike quiz analytics, this is workspace-wide (not per-quiz) because
 * downloads aren't tied to a specific quiz — they happen via /get/[slug],
 * quiz results pages, and shared links.
 */
export async function computeDocumentDownloads(
  workspaceId: string,
  windowDays = 30,
): Promise<DocumentDownloadReport> {
  const { createServiceRoleClient } = await import("@/lib/supabase/server");
  const supabase = createServiceRoleClient();

  const since = daysAgoIso(windowDays);

  const { data: events } = await supabase
    .from("document_downloads")
    .select("document_id, is_gated, utm_source, referrer, downloaded_at")
    .eq("workspace_id", workspaceId)
    .gte("downloaded_at", since);

  const rows = events ?? [];

  // Load document titles for the ones that have downloads.
  const docIds = Array.from(new Set(rows.map((r) => r.document_id)));
  const titleMap: Record<string, { title: string; slug: string }> = {};

  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, slug")
      .in("id", docIds);
    for (const d of docs ?? []) {
      titleMap[d.id] = { title: d.title, slug: d.slug };
    }
  }

  // Aggregate by document.
  const byDocMap: Record<string, DocumentDownloadStat> = {};
  for (const row of rows) {
    const meta = titleMap[row.document_id] ?? { title: "(deleted)", slug: "" };
    if (!byDocMap[row.document_id]) {
      byDocMap[row.document_id] = {
        document_id: row.document_id,
        title: meta.title,
        slug: meta.slug,
        total: 0,
        gated: 0,
        anonymous: 0,
      };
    }
    const stat = byDocMap[row.document_id];
    stat.total += 1;
    if (row.is_gated) stat.gated += 1;
    else stat.anonymous += 1;
  }

  // Aggregate by source (utm_source, falling back to referrer host, then "direct").
  const bySourceMap: Record<string, number> = {};
  for (const row of rows) {
    let source = row.utm_source?.trim() || "";
    if (!source && row.referrer) {
      try {
        source = new URL(row.referrer).hostname.replace(/^www\./, "");
      } catch {
        source = "";
      }
    }
    if (!source) source = "direct";
    bySourceMap[source] = (bySourceMap[source] ?? 0) + 1;
  }

  const byDocument = Object.values(byDocMap).sort((a, b) => b.total - a.total);
  const bySource = Object.entries(bySourceMap)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDownloads: rows.length,
    totalAnonymous: rows.filter((r) => !r.is_gated).length,
    totalGated: rows.filter((r) => r.is_gated).length,
    byDocument,
    bySource,
    windowDays,
  };
}
