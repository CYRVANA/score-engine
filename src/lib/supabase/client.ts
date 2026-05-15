import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (Client Components only).
 * Uses the ANON key; all queries are subject to RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
