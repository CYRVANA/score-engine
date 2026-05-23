"use server";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { validateEmail, emailValidationMessage } from "@/lib/email-validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isDestinationsEnabled } from "@/lib/feature-flags";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

export type DirectLeadCaptureInput = {
  document_id: string;
  email: string;
  name: string;
  honeypot: string;
  consent: boolean;
};

export type DirectLeadCaptureResult =
  | { ok: true; lead_id: string }
  | { ok: false; error: string };

/**
 * Capture a lead via direct document download (no quiz).
 *
 * Flow:
 *   1. Validate input (honeypot, rate limit, email)
 *   2. Check if a lead with this email already exists in this workspace
 *      — if yes, reuse it to avoid duplicate contacts in HubSpot
 *      — if no, create a new lead (quiz_id = null)
 *   3. Grant document_access (idempotent via ON CONFLICT DO NOTHING)
 *   4. Enqueue destination_deliveries for HubSpot contact upsert
 *   5. Enqueue document_deliveries for HubSpot document event update
 */
export async function captureDirectLead(
  input: DirectLeadCaptureInput,
): Promise<DirectLeadCaptureResult> {
  const hdrs = await headers();
  const clientIp = getClientIp(hdrs);

  // --- 1. Honeypot ---
  if (input.honeypot && input.honeypot.trim() !== "") {
    return { ok: true, lead_id: "00000000-0000-0000-0000-000000000000" };
  }

  // --- 2. Consent required ---
  if (!input.consent) {
    return { ok: false, error: "Please accept the terms to continue." };
  }

  // --- 3. Rate limit ---
  const allowed = await checkRateLimit({
    scope: "direct_download",
    key: clientIp,
    limit: 10,
    windowSeconds: 600, // 10 minutes
  });
  if (!allowed) {
    return {
      ok: false,
      error: "Too many requests from this network. Please wait a few minutes and try again.",
    };
  }

  // --- 4. Email validation ---
  const emailCheck = validateEmail(input.email);
  if (!emailCheck.ok) {
    return { ok: false, error: emailValidationMessage(emailCheck.reason) };
  }

  const supabase = createServiceRoleClient();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const now = new Date().toISOString();

  // --- 5. Verify document exists and is accessible ---
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, title, bucket, storage_path, access_level, is_direct_accessible, is_active")
    .eq("id", input.document_id)
    .eq("workspace_id", WORKSPACE_ID)
    .single();

  if (docErr || !doc) {
    return { ok: false, error: "Document not found." };
  }
  if (!doc.is_active) {
    return { ok: false, error: "This resource is no longer available." };
  }
  if (!doc.is_direct_accessible) {
    return { ok: false, error: "This resource is only available via assessment results." };
  }

  // --- 6. Find existing lead for this email (any quiz or direct) ---
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, email")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("email", email)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId: string;

  if (existingLead) {
    // Reuse existing lead — keeps HubSpot deduped.
    leadId = existingLead.id;
  } else {
    // Create a new lead with quiz_id = null.
    const { data: newLead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        workspace_id: WORKSPACE_ID,
        quiz_id: null,
        session_id: null,  // no session for direct downloads
        email,
        name: name || null,
        custom_fields: { consent_at: now, source: "direct_download" },
        captured_at: now,
      })
      .select("id")
      .single();

    if (leadErr || !newLead) {
      console.error("[captureDirectLead] lead insert failed", leadErr);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
    leadId = newLead.id;
  }

  // --- 7. Grant document access (idempotent) ---
  const { data: access, error: accessErr } = await supabase
    .from("document_access")
    .upsert(
      {
        document_id: doc.id,
        lead_id: leadId,
        granted_by: "direct_download",
        granted_at: now,
      },
      { onConflict: "lead_id,document_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (accessErr || !access) {
    console.error("[captureDirectLead] access grant failed", accessErr);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // --- 8. Enqueue destination deliveries (HubSpot contact upsert) ---
  // Only for new leads — existing leads already have a HubSpot contact.
  if (!existingLead && isDestinationsEnabled()) {
    try {
      const { data: destinations } = await supabase
        .from("destinations")
        .select("id")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("active", true)
        .is("quiz_id", null);  // workspace-wide destinations only

      if (destinations && destinations.length > 0) {
        const payload = {
          email,
          name: name || null,
          quiz_title: null,
          quiz_slug: null,
          score: null,
          tier_title: null,
          captured_at: now,
          source: "direct_download",
          document_title: doc.title,
        };
        await supabase.from("destination_deliveries").insert(
          destinations.map((d) => ({
            destination_id: d.id,
            lead_id: leadId,
            payload,
            status: "pending",
          })),
        );
      }
    } catch (e) {
      console.error("[captureDirectLead] destination enqueue failed", e);
    }
  }

  // --- 9. Enqueue document deliveries (HubSpot document event update) ---
  if (isDestinationsEnabled()) {
    try {
      const { data: destinations } = await supabase
        .from("destinations")
        .select("id")
        .eq("workspace_id", WORKSPACE_ID)
        .eq("active", true)
        .is("quiz_id", null);

      if (destinations && destinations.length > 0) {
        await supabase.from("document_deliveries").insert(
          destinations.map((d) => ({
            access_id: access.id,
            lead_id: leadId,
            destination_id: d.id,
            status: "pending",
          })),
        );
      }
    } catch (e) {
      console.error("[captureDirectLead] document delivery enqueue failed", e);
    }
  }

  return { ok: true, lead_id: leadId };
}
