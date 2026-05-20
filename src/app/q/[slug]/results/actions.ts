"use server";

import { createServiceRoleClient } from "@/lib/supabase/server";

export type NarrativeStatusResult =
  | { status: "ready"; body: string }
  | { status: "pending" }
  | { status: "failed"; error: string }
  | { status: "missing" };

/**
 * Poll narrative status for a given session.
 *
 * Called repeatedly by the results page client component until the narrative
 * resolves to "ready" or "failed". Returns "missing" if no narrative row
 * exists (i.e. AI narratives are disabled for this deployment).
 *
 * Uses the service-role client because anonymous quiz takers don't have a
 * Supabase Auth session. The session UUID acts as the access token, same
 * pattern as the rest of the results page.
 */
export async function getNarrativeStatus(
  sessionId: string,
): Promise<NarrativeStatusResult> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("ai_narratives")
    .select("status, body, last_error")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { status: "failed", error: error.message };
  }
  if (!data) {
    return { status: "missing" };
  }

  if (data.status === "delivered" && data.body) {
    return { status: "ready", body: data.body };
  }
  if (data.status === "failed") {
    return { status: "failed", error: data.last_error ?? "Generation failed" };
  }
  // pending / retrying / in_flight all read as "pending" to the UI
  return { status: "pending" };
}
