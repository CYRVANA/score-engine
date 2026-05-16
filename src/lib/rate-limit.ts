import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * IP-based rate limiter backed by the rate_limits table + check_rate_limit
 * Postgres function (see migration 0005). Server-side only.
 *
 * Returns true if the attempt is allowed (and was recorded).
 * Returns false if the limit has been exceeded.
 *
 * Fail-open behavior: if the rate-limit query itself errors (DB blip),
 * we allow the attempt. The alternative is locking out legitimate leads
 * when Supabase has a transient issue, which is worse than letting through
 * an extra bot attempt.
 */
export async function checkRateLimit(opts: {
  scope: string;
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_scope: opts.scope,
    p_key: opts.key,
    p_limit: opts.limit,
    p_window_secs: opts.windowSeconds,
  });

  if (error) {
    // Fail-open. Log the error so we can spot DB-level issues.
    console.error("[rate-limit] DB error, failing open:", error.message);
    return true;
  }

  return data === true;
}

/**
 * Extract a best-effort client IP from request headers.
 * Order matters: trust the platform-specific header first, fall back to common proxies.
 *
 * Note: x-forwarded-for can be spoofed if the request doesn't pass through a
 * trusted reverse proxy. For Netlify, x-nf-client-connection-ip is set by
 * Netlify's edge and is not spoofable from the client.
 */
export function getClientIp(headers: Headers): string {
  const nfIp = headers.get("x-nf-client-connection-ip");
  if (nfIp) return nfIp;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for is "client, proxy1, proxy2, ..." — first is the client.
    return xff.split(",")[0].trim();
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}
