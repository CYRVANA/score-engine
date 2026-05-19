"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  testHubSpotConnection,
  provisionHubSpotProperties,
  type DestinationType,
} from "@/lib/destinations/types";

// ============================================================================
// Helper: set the encryption key on this DB session.
// Must be called before any encrypt/decrypt invocation.
// ============================================================================
async function setEncryptionKey(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.DESTINATION_SECRETS_KEY;
  if (!key) {
    return {
      ok: false,
      error:
        "DESTINATION_SECRETS_KEY is not configured on this server. Set it in your Netlify env vars.",
    };
  }
  const { error } = await supabase.rpc("set_destination_secrets_key", {
    value: key,
  });
  if (error) return { ok: false, error: `Failed to set encryption key: ${error.message}` };
  return { ok: true };
}

// ============================================================================
// Test HubSpot token
// ============================================================================
export type TestTokenResult =
  | { ok: true; details: string }
  | { ok: false; error: string };

export async function testHubSpotToken(token: string): Promise<TestTokenResult> {
  await requireAdmin();
  const result = await testHubSpotConnection(token);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, details: result.details ?? "Connected." };
}

// ============================================================================
// Create destination
// ============================================================================
export type CreateDestinationInput = {
  name: string;
  type: DestinationType;
  quiz_id: string | null; // null = applies to all quizzes in workspace
  config: Record<string, unknown>;
};

export type CreateDestinationResult =
  | { ok: true; destination_id: string }
  | { ok: false; error: string };

export async function createDestination(
  input: CreateDestinationInput,
): Promise<CreateDestinationResult> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 200) return { ok: false, error: "Name must be 200 characters or fewer." };

  if (input.type !== "hubspot" && input.type !== "generic_webhook") {
    return { ok: false, error: "Unknown destination type." };
  }

  // For HubSpot: verify token works AND provision custom properties before saving.
  if (input.type === "hubspot") {
    const token = typeof input.config.access_token === "string" ? input.config.access_token : "";
    if (!token) return { ok: false, error: "HubSpot Private App token is required." };

    const test = await testHubSpotConnection(token);
    if (!test.ok) return { ok: false, error: `Token test failed: ${test.error}` };

    const provision = await provisionHubSpotProperties(token);
    if (!provision.ok) return { ok: false, error: provision.error };
  }

  if (input.type === "generic_webhook") {
    const url = typeof input.config.url === "string" ? input.config.url : "";
    if (!url) return { ok: false, error: "Webhook URL is required." };
    if (!/^https?:\/\//i.test(url))
      return { ok: false, error: "Webhook URL must start with http:// or https://" };
  }

  // Verify quiz_id (if set) belongs to this workspace.
  if (input.quiz_id) {
    const { data: quiz, error: qErr } = await supabase
      .from("quizzes")
      .select("id")
      .eq("id", input.quiz_id)
      .eq("workspace_id", profile.workspace_id)
      .single();
    if (qErr || !quiz) return { ok: false, error: "Quiz not found in your workspace." };
  }

  // Set encryption key, then encrypt the config.
  const keyResult = await setEncryptionKey(supabase);
  if (!keyResult.ok) return { ok: false, error: keyResult.error };

  const { data: encrypted, error: encErr } = await supabase.rpc(
    "encrypt_destination_config",
    { plain: input.config },
  );
  if (encErr || !encrypted) {
    return {
      ok: false,
      error: `Failed to encrypt config: ${encErr?.message ?? "unknown error"}`,
    };
  }

  const { data: created, error: createErr } = await supabase
    .from("destinations")
    .insert({
      workspace_id: profile.workspace_id,
      quiz_id: input.quiz_id,
      type: input.type,
      name,
      config_encrypted: encrypted as string,
      active: true,
      last_test_at: new Date().toISOString(),
      last_test_status: "ok",
    })
    .select("id")
    .single();

  if (createErr || !created) {
    return {
      ok: false,
      error: `Failed to save destination: ${createErr?.message ?? "unknown error"}`,
    };
  }

  revalidatePath("/admin/destinations");
  return { ok: true, destination_id: created.id };
}

// ============================================================================
// Toggle active / deactivate
// ============================================================================
export async function setDestinationActive(
  destId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: dest, error: fetchErr } = await supabase
    .from("destinations")
    .select("id, workspace_id")
    .eq("id", destId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (fetchErr || !dest) return { ok: false, error: "Destination not found." };

  const { error: updErr } = await supabase
    .from("destinations")
    .update({ active: active })
    .eq("id", destId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/admin/destinations");
  revalidatePath(`/admin/destinations/${destId}`);
  return { ok: true };
}

// ============================================================================
// Delete destination
// ============================================================================
export async function deleteDestination(
  destId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: dest, error: fetchErr } = await supabase
    .from("destinations")
    .select("id")
    .eq("id", destId)
    .eq("workspace_id", profile.workspace_id)
    .single();
  if (fetchErr || !dest) return { ok: false, error: "Destination not found." };

  // Hard delete. FK cascade removes destination_deliveries rows.
  const { error: delErr } = await supabase.from("destinations").delete().eq("id", destId);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath("/admin/destinations");
  return { ok: true };
}

// ============================================================================
// Retry a failed delivery — push it back to pending so the worker re-attempts.
// ============================================================================
export async function retryDelivery(
  deliveryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const supabase = createServiceRoleClient();

  // Verify the delivery's destination belongs to this workspace.
  const { data: delivery, error: fetchErr } = await supabase
    .from("destination_deliveries")
    .select("id, destination_id, destinations:destination_id (workspace_id)")
    .eq("id", deliveryId)
    .single();

  if (fetchErr || !delivery) return { ok: false, error: "Delivery not found." };

  const dest = Array.isArray(delivery.destinations)
    ? delivery.destinations[0]
    : delivery.destinations;
  if (!dest || dest.workspace_id !== profile.workspace_id) {
    return { ok: false, error: "Delivery not found in your workspace." };
  }

  const { error: updErr } = await supabase
    .from("destination_deliveries")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", deliveryId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/admin/destinations");
  return { ok: true };
}

// ============================================================================
// Form-action wrappers
// ============================================================================
export async function createDestinationFormAction(formData: FormData) {
  const type = String(formData.get("type") ?? "") as DestinationType;
  const config: Record<string, unknown> = {};

  if (type === "hubspot") {
    config.access_token = String(formData.get("access_token") ?? "").trim();
  } else if (type === "generic_webhook") {
    config.url = String(formData.get("url") ?? "").trim();
    const secret = String(formData.get("shared_secret") ?? "").trim();
    if (secret) config.shared_secret = secret;
  }

  const quizIdRaw = String(formData.get("quiz_id") ?? "");
  const quizId = quizIdRaw && quizIdRaw !== "all" ? quizIdRaw : null;

  const result = await createDestination({
    name: String(formData.get("name") ?? ""),
    type,
    quiz_id: quizId,
    config,
  });

  if (result.ok) redirect(`/admin/destinations/${result.destination_id}`);
  return result;
}
