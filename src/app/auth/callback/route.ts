import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback handler for Supabase magic links.
 *
 * Supabase Auth sends users to this URL with a `code` query param after they
 * click the magic link in their email. We exchange the code for a session
 * (sets the auth cookie), then redirect to /admin.
 *
 * If the email isn't in admin_whitelist, the auth signin still succeeds at
 * the Supabase level, but requireAdmin() on /admin will sign them out and
 * bounce them back to /admin/login?error=not_admin.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code missing or exchange failed.
  return NextResponse.redirect(`${origin}/admin/login?error=link_invalid`);
}
