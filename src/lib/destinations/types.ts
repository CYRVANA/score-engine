/**
 * Destination types — shared between the Server Actions in the Next.js app
 * (which configure and test destinations) and the Edge Function (which
 * delivers to them).
 *
 * The actual delivery logic lives in the Edge Function. This module is for
 * the bits the admin UI needs: validation, connection testing, redacted
 * display of stored configs.
 */

export type DestinationType = "hubspot" | "generic_webhook";

export type HubSpotConfig = {
  access_token: string;
};

export type GenericWebhookConfig = {
  url: string;
  shared_secret?: string;
};

export type DestinationConfig = HubSpotConfig | GenericWebhookConfig;

export type TestConnectionResult =
  | { ok: true; details?: string }
  | { ok: false; error: string };

/**
 * Test a HubSpot Private App token by making a low-cost authenticated call.
 * Returns the portal name on success — gives the user confidence they hit
 * the right portal.
 */
export async function testHubSpotConnection(
  token: string,
): Promise<TestConnectionResult> {
  if (!token || !token.startsWith("pat-")) {
    return { ok: false, error: "Token should start with 'pat-' (HubSpot Private App format)." };
  }

  try {
    const response = await fetch("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      return { ok: false, error: "HubSpot rejected the token (401 Unauthorized)." };
    }
    if (response.status === 403) {
      return {
        ok: false,
        error: "Token is valid but lacks required scopes. Grant crm.objects.contacts.write and crm.schemas.contacts.write.",
      };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `HubSpot returned ${response.status}: ${text.slice(0, 300)}` };
    }

    const data = await response.json().catch(() => ({}));
    const portalId = data?.portalId ?? "(unknown)";
    return { ok: true, details: `Connected to HubSpot portal ${portalId}.` };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error: ${err}` };
  }
}

/**
 * Provision custom Contact properties used by score-engine.
 * Idempotent — HubSpot returns 409 if a property already exists, which we treat as success.
 *
 * Properties created:
 *   score_engine_score        — number   (the quiz score)
 *   score_engine_tier         — string   (tier title)
 *   score_engine_quiz         — string   (quiz title)
 *   score_engine_quiz_slug    — string   (quiz slug)
 *   score_engine_captured_at  — datetime (when the lead was captured)
 *
 * Called once when a destination is first saved with a valid token.
 */
export async function provisionHubSpotProperties(
  token: string,
): Promise<TestConnectionResult> {
  const props = [
    {
      name: "score_engine_score",
      label: "score-engine Score",
      type: "number",
      fieldType: "number",
      groupName: "contactinformation",
      description: "The score this contact received on a score-engine assessment.",
    },
    {
      name: "score_engine_tier",
      label: "score-engine Tier",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Result tier the contact landed in.",
    },
    {
      name: "score_engine_quiz",
      label: "score-engine Quiz",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Title of the quiz the contact took.",
    },
    {
      name: "score_engine_quiz_slug",
      label: "score-engine Quiz Slug",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Slug of the quiz the contact took.",
    },
    {
      name: "score_engine_captured_at",
      label: "score-engine Captured At",
      type: "datetime",
      fieldType: "date",
      groupName: "contactinformation",
      description: "When the contact submitted the quiz email gate.",
    },
    {
      name: "score_engine_last_download",
      label: "score-engine Last Download",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Title of the most recently downloaded resource from score-engine.",
    },
    {
      name: "score_engine_download_count",
      label: "score-engine Download Count",
      type: "number",
      fieldType: "number",
      groupName: "contactinformation",
      description: "Total number of resources this contact has downloaded.",
    },
    {
      name: "score_engine_downloads",
      label: "score-engine Downloads",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      description: "Semicolon-separated list of all resources this contact has downloaded.",
    },
  ];

  for (const prop of props) {
    try {
      const response = await fetch(
        "https://api.hubapi.com/crm/v3/properties/contacts",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(prop),
        },
      );

      // 409 = already exists. 201 = created. Both fine.
      if (response.status === 201 || response.status === 409) continue;

      if (response.status === 403) {
        return {
          ok: false,
          error: "Token lacks crm.schemas.contacts.write scope (needed to create custom properties).",
        };
      }

      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Couldn't provision property ${prop.name}: HTTP ${response.status} ${text.slice(0, 200)}`,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Network error provisioning ${prop.name}: ${err}` };
    }
  }

  return { ok: true, details: "All custom properties provisioned." };
}

/**
 * Return a safe-to-display redacted version of a destination config —
 * everything except the secrets is preserved, secrets show only their tail.
 */
export function redactDestinationConfig(
  type: DestinationType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (type === "hubspot") {
    const token = typeof config.access_token === "string" ? config.access_token : "";
    return {
      access_token: token ? `…${token.slice(-4)}` : "",
    };
  }
  if (type === "generic_webhook") {
    return {
      url: config.url ?? "",
      shared_secret: config.shared_secret
        ? `…${String(config.shared_secret).slice(-4)}`
        : "",
    };
  }
  return {};
}
