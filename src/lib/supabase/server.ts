import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route Handlers).
 *
 * Uses the ANON key + the user's auth cookie, so RLS applies.
 * For writes that need to bypass RLS (lead capture, system inserts), use
 * the service-role client below instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // Safely ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  );
}

/**
 * SERVICE-ROLE Supabase client. Bypasses RLS. SERVER-ONLY.
 *
 * Use for: lead capture, session/answer writes, destination delivery worker.
 * Never import this from a client component or expose its responses to the client
 * without filtering by workspace.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  if (typeof window !== "undefined") {
    throw new Error("Service-role client must not be used in the browser.");
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
