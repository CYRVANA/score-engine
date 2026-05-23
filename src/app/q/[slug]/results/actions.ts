"use server";

import { createServiceRoleClient } from "@/lib/supabase/server";

export type NarrativeStatusResult =
  | { status: "ready"; body: string }
  | { status: "pending" }
  | { status: "failed"; error: string }
  | { status: "missing" };

/**
 * Poll narrative status for a given session.
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
  return { status: "pending" };
}

export type DocumentForDownload = {
  id: string;
  title: string;
  description: string | null;
  access_level: string;
  download_url: string;
};

/**
 * Fetch documents the lead has access to for this session.
 *
 * Returns a branded proxy URL (/download/[slug]?s=<lead_id>) for each.
 * The proxy logs the download event and redirects to the file — no signed
 * URLs are generated here, and no Supabase Storage URL is exposed client-side.
 *
 * Called server-side on the results page.
 */
export async function getDocumentsForSession(
  sessionId: string,
  leadId: string,
): Promise<DocumentForDownload[]> {
  const supabase = createServiceRoleClient();

  const { data: grants, error } = await supabase
    .from("document_access")
    .select(
      `
      id, expires_at,
      documents:document_id (
        id, title, description, slug, access_level
      )
    `,
    )
    .eq("lead_id", leadId);

  if (error || !grants || grants.length === 0) return [];

  const results: DocumentForDownload[] = [];

  for (const grant of grants) {
    if (grant.expires_at && new Date(grant.expires_at) < new Date()) continue;

    const doc = Array.isArray(grant.documents) ? grant.documents[0] : grant.documents;
    if (!doc) continue;

    // Public docs don't need the lead id; gated docs do (proxy re-verifies).
    const downloadUrl =
      doc.access_level === "public"
        ? `/download/${doc.slug}`
        : `/download/${doc.slug}?s=${leadId}`;

    results.push({
      id: doc.id,
      title: doc.title,
      description: doc.description,
      access_level: doc.access_level,
      download_url: downloadUrl,
    });
  }

  return results;
}

