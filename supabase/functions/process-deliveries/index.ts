// score-engine — destinations outbox worker.
// Runs every 60 seconds via pg_cron. Drains the outbox, calls the appropriate
// destination adapter, records results. Deno runtime (Supabase Edge Function).
//
// See docs/ARCHITECTURE.md §9 and §17 for the design rationale.
//
// Deploy:
//   supabase functions deploy process-deliveries
//
// Required env vars (set in Supabase dashboard → Edge Functions → process-deliveries → Secrets):
//   SUPABASE_URL                  — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY     — auto-set by Supabase
//   DESTINATION_SECRETS_KEY       — symmetric key for pgcrypto encryption (you set this)

import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// Configuration
// ============================================================================
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;
// Exponential backoff in seconds: 30s, 2m, 8m, 30m, 2h, 8h.
const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200, 28800];

// ============================================================================
// Types
// ============================================================================
type DeliveryRow = {
  id: string;
  destination_id: string;
  lead_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  status: string;
};

type DestinationRow = {
  id: string;
  workspace_id: string;
  type: string;
  config_encrypted: string;
  active: boolean;
};

type AdapterResult =
  | { ok: true; external_id?: string }
  | { ok: false; error: string; retriable: boolean };

// ============================================================================
// Entry point
// ============================================================================
Deno.serve(async (_req: Request) => {
  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretsKey = Deno.env.get("DESTINATION_SECRETS_KEY");

  if (!supabaseUrl || !serviceRoleKey || !secretsKey) {
    console.error("[process-deliveries] missing required env vars");
    return new Response(
      JSON.stringify({ ok: false, error: "Missing env vars" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "public" },
    auth: { persistSession: false },
  });

  // Set the encryption key on this session so decrypt_destination_config can use it.
  // RPC wrapper around set_config because Supabase client doesn't expose set_config directly.
  await supabase.rpc("set_config", {
    parameter: "app.destination_secrets_key",
    value: secretsKey,
    is_local: false,
  });

  // ==========================================================================
  // 1. Pull a batch of due deliveries.
  // ==========================================================================
  const { data: deliveries, error: pullErr } = await supabase
    .from("destination_deliveries")
    .select("id, destination_id, lead_id, payload, attempt_count, status")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (pullErr) {
    console.error("[process-deliveries] failed to pull batch:", pullErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: pullErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!deliveries || deliveries.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, durationMs: Date.now() - startedAt }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ==========================================================================
  // 2. Mark them in_flight so a concurrent worker invocation doesn't double-process.
  //    (pg_cron isn't supposed to overlap, but better safe.)
  // ==========================================================================
  const inFlightIds = deliveries.map((d: DeliveryRow) => d.id);
  await supabase
    .from("destination_deliveries")
    .update({ status: "in_flight", last_attempt_at: new Date().toISOString() })
    .in("id", inFlightIds);

  // ==========================================================================
  // 3. Group by destination_id so we only decrypt config once per destination.
  // ==========================================================================
  const byDestination = new Map<string, DeliveryRow[]>();
  for (const d of deliveries as DeliveryRow[]) {
    const arr = byDestination.get(d.destination_id) ?? [];
    arr.push(d);
    byDestination.set(d.destination_id, arr);
  }

  let succeeded = 0;
  let failed = 0;

  for (const [destId, items] of byDestination) {
    // Fetch destination + decrypted config.
    const { data: dest, error: destErr } = await supabase
      .from("destinations")
      .select("id, workspace_id, type, config_encrypted, active")
      .eq("id", destId)
      .single();

    if (destErr || !dest) {
      console.error(`[process-deliveries] destination ${destId} not found`);
      await markFailed(supabase, items, "destination_not_found", false);
      failed += items.length;
      continue;
    }

    if (!dest.active) {
      console.log(`[process-deliveries] destination ${destId} inactive; skipping`);
      await markFailed(supabase, items, "destination_inactive", false);
      failed += items.length;
      continue;
    }

    let config: Record<string, unknown>;
    try {
      const { data: decrypted, error: dErr } = await supabase.rpc(
        "decrypt_destination_config",
        { cipher: dest.config_encrypted },
      );
      if (dErr) throw new Error(dErr.message);
      config = decrypted as Record<string, unknown>;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error(`[process-deliveries] failed to decrypt config for ${destId}:`, err);
      await markFailed(supabase, items, `decrypt_failed: ${err}`, false);
      failed += items.length;
      continue;
    }

    // Process each delivery for this destination.
    for (const item of items) {
      const result = await deliver(dest as DestinationRow, config, item);
      if (result.ok) {
        await supabase
          .from("destination_deliveries")
          .update({
            status: "delivered",
            delivered_at: new Date().toISOString(),
            attempt_count: item.attempt_count + 1,
            external_id: result.external_id ?? null,
            last_error: null,
          })
          .eq("id", item.id);
        succeeded++;
      } else {
        const nextAttempt = item.attempt_count + 1;
        if (nextAttempt >= MAX_ATTEMPTS || !result.retriable) {
          await supabase
            .from("destination_deliveries")
            .update({
              status: "failed",
              attempt_count: nextAttempt,
              last_error: result.error,
            })
            .eq("id", item.id);
        } else {
          const backoffSec = BACKOFF_SECONDS[Math.min(nextAttempt, BACKOFF_SECONDS.length - 1)];
          const nextTime = new Date(Date.now() + backoffSec * 1000).toISOString();
          await supabase
            .from("destination_deliveries")
            .update({
              status: "retrying",
              attempt_count: nextAttempt,
              next_attempt_at: nextTime,
              last_error: result.error,
            })
            .eq("id", item.id);
        }
        failed++;
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: deliveries.length,
      succeeded,
      failed,
      durationMs: Date.now() - startedAt,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

// ============================================================================
// Helper: mark a batch as terminal-failed (no retry path).
// ============================================================================
async function markFailed(
  supabase: ReturnType<typeof createClient>,
  items: DeliveryRow[],
  reason: string,
  _retriable: boolean,
) {
  await supabase
    .from("destination_deliveries")
    .update({
      status: "failed",
      last_error: reason,
      attempt_count: items[0].attempt_count + 1,
    })
    .in(
      "id",
      items.map((i) => i.id),
    );
}

// ============================================================================
// Dispatch by destination type.
// ============================================================================
async function deliver(
  dest: DestinationRow,
  config: Record<string, unknown>,
  item: DeliveryRow,
): Promise<AdapterResult> {
  switch (dest.type) {
    case "hubspot":
      return deliverHubSpot(config, item);
    case "generic_webhook":
      return deliverGenericWebhook(config, item);
    default:
      return {
        ok: false,
        error: `Unknown destination type: ${dest.type}`,
        retriable: false,
      };
  }
}

// ============================================================================
// HubSpot adapter — upsert a Contact via the batch upsert endpoint.
// Per ARCHITECTURE.md §14.7: Contact upsert only, no Deals.
// ============================================================================
async function deliverHubSpot(
  config: Record<string, unknown>,
  item: DeliveryRow,
): Promise<AdapterResult> {
  const token = typeof config.access_token === "string" ? config.access_token : "";
  if (!token) {
    return { ok: false, error: "Missing access_token in destination config", retriable: false };
  }

  const payload = item.payload as {
    email?: string;
    name?: string;
    phone?: string;
    quiz_title?: string;
    quiz_slug?: string;
    score?: number;
    tier_title?: string;
    captured_at?: string;
  };

  if (!payload.email) {
    return { ok: false, error: "Payload missing email", retriable: false };
  }

  // Map our lead shape to HubSpot Contact properties.
  // First/last name parsed from the name field; HubSpot stores them separately.
  const { firstName, lastName } = splitName(payload.name ?? "");

  const properties: Record<string, string | number> = {
    email: payload.email,
    ...(firstName && { firstname: firstName }),
    ...(lastName && { lastname: lastName }),
    ...(payload.phone && { phone: payload.phone }),
    ...(payload.score !== undefined && { score_engine_score: payload.score }),
    ...(payload.tier_title && { score_engine_tier: payload.tier_title }),
    ...(payload.quiz_title && { score_engine_quiz: payload.quiz_title }),
    ...(payload.quiz_slug && { score_engine_quiz_slug: payload.quiz_slug }),
    ...(payload.captured_at && { score_engine_captured_at: payload.captured_at }),
  };

  // Use the simple-create endpoint with `idProperty=email`, which acts as upsert.
  const url = "https://api.hubapi.com/crm/v3/objects/contacts?idProperty=email";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (response.status === 201 || response.status === 200) {
      const data = await response.json().catch(() => ({}));
      return { ok: true, external_id: data?.id };
    }

    // HubSpot returns 409 when contact exists; we should fall back to update.
    if (response.status === 409) {
      return updateExistingHubSpotContact(token, payload.email, properties);
    }

    const text = await response.text().catch(() => "");
    const retriable = response.status >= 500 || response.status === 429;
    return {
      ok: false,
      error: `HubSpot ${response.status}: ${text.slice(0, 500)}`,
      retriable,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error: ${err}`, retriable: true };
  }
}

async function updateExistingHubSpotContact(
  token: string,
  email: string,
  properties: Record<string, string | number>,
): Promise<AdapterResult> {
  // PATCH /crm/v3/objects/contacts/{email}?idProperty=email
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: true, external_id: data?.id };
    }

    const text = await response.text().catch(() => "");
    const retriable = response.status >= 500 || response.status === 429;
    return {
      ok: false,
      error: `HubSpot update ${response.status}: ${text.slice(0, 500)}`,
      retriable,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error on update: ${err}`, retriable: true };
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ============================================================================
// Generic webhook adapter — POSTs the payload JSON to a configured URL.
// Built alongside HubSpot since the pattern is the same and it's near-zero cost.
// ============================================================================
async function deliverGenericWebhook(
  config: Record<string, unknown>,
  item: DeliveryRow,
): Promise<AdapterResult> {
  const url = typeof config.url === "string" ? config.url : "";
  if (!url) return { ok: false, error: "Missing url in destination config", retriable: false };

  const sharedSecret = typeof config.shared_secret === "string" ? config.shared_secret : "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sharedSecret && { "X-Score-Engine-Secret": sharedSecret }),
      },
      body: JSON.stringify(item.payload),
    });

    if (response.ok) return { ok: true };

    const text = await response.text().catch(() => "");
    const retriable = response.status >= 500 || response.status === 429;
    return {
      ok: false,
      error: `Webhook ${response.status}: ${text.slice(0, 500)}`,
      retriable,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error: ${err}`, retriable: true };
  }
}
