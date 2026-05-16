import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-out endpoint at /admin/logout.
 *
 * Intentionally a POST-only route. The admin layout's "Sign out" button
 * uses a form that POSTs here. Prevents CSRF-style sign-outs from random
 * <img src="/admin/logout"> tags.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(
    new URL(
      "/admin/login",
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.cyrvana.com",
    ),
  );
}

