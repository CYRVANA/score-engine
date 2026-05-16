"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type ExportResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string };

/**
 * Generate a CSV of leads matching the supplied filters.
 *
 * Always scoped to the admin's workspace — even if a different workspace_id
 * were somehow supplied (which it can't from the UI), requireAdmin pins it.
 *
 * Cap at 10k rows per export. If you have more than that, you almost certainly
 * want to filter down first (or do bulk extract via SQL).
 */
const EXPORT_HARD_CAP = 10_000;

const CSV_COLUMNS = [
  "captured_at",
  "email",
  "name",
  "quiz_title",
  "score",
  "tier_title",
  "client_ip",
  "consent_at",
  "session_id",
] as const;

type LeadRow = {
  email: string;
  name: string | null;
  captured_at: string;
  session_id: string;
  custom_fields: Record<string, unknown> | null;
  quizzes: { title: string } | { title: string }[] | null;
  sessions:
    | {
        score: number | null;
        result_tiers:
          | { title: string }
          | { title: string }[]
          | null;
      }
    | {
        score: number | null;
        result_tiers:
          | { title: string }
          | { title: string }[]
          | null;
      }[]
    | null;
};

export async function exportLeads(args: {
  quizId: string | null;
  searchQuery: string;
}): Promise<ExportResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  let query = supabase
    .from("leads")
    .select(
      `
      email,
      name,
      captured_at,
      session_id,
      custom_fields,
      quizzes:quiz_id ( title ),
      sessions:session_id ( score, result_tiers:result_tier_id ( title ) )
    `,
    )
    .eq("workspace_id", profile.workspace_id)
    .order("captured_at", { ascending: false })
    .limit(EXPORT_HARD_CAP);

  if (args.quizId) {
    query = query.eq("quiz_id", args.quizId);
  }
  if (args.searchQuery) {
    query = query.ilike("email", `%${args.searchQuery}%`);
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as LeadRow[];
  const csv = buildCsv(rows);

  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `score-engine-leads-${now}.csv`;

  return { ok: true, csv, filename };
}

function buildCsv(rows: LeadRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map(rowToCsv).join("\n");
  return body ? `${header}\n${body}` : header;
}

function rowToCsv(row: LeadRow): string {
  const quiz = Array.isArray(row.quizzes) ? row.quizzes[0] : row.quizzes;
  const session = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions;
  const tier = session
    ? Array.isArray(session.result_tiers)
      ? session.result_tiers[0]
      : session.result_tiers
    : null;

  const customFields = row.custom_fields ?? {};
  const clientIp = typeof customFields.client_ip === "string" ? customFields.client_ip : "";
  const consentAt = typeof customFields.consent_at === "string" ? customFields.consent_at : "";

  const values: Record<(typeof CSV_COLUMNS)[number], string> = {
    captured_at: row.captured_at ?? "",
    email: row.email ?? "",
    name: row.name ?? "",
    quiz_title: quiz?.title ?? "",
    score: session?.score?.toString() ?? "",
    tier_title: tier?.title ?? "",
    client_ip: clientIp,
    consent_at: consentAt,
    session_id: row.session_id ?? "",
  };

  return CSV_COLUMNS.map((col) => escapeCsvCell(values[col])).join(",");
}

/**
 * RFC 4180–compliant cell escaping. Quote any cell containing comma, double
 * quote, or newline; double up internal double quotes.
 */
function escapeCsvCell(value: string): string {
  if (value === "") return "";
  const needsQuoting = /[",\n\r]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
