"use server";

import { createClient } from "@/lib/supabase/server";

export type SendMagicLinkResult =
  | { ok: true; sent_to: string }
  | { ok: false; error: string };

/**
 * Send a magic-link email to the provided address.
 *
 * Important: we do NOT verify the address is in admin_whitelist here. That's
 * deliberate — revealing whether an email is whitelisted is itself an
 * information leak. Instead:
 *   - Supabase Auth sends the magic link regardless
 *   - When the user clicks it and the callback completes, requireAdmin() on
 *     /admin rejects non-whitelisted users
 *   - From an outsider's perspective, every email gets the same "check your
 *     inbox" response
 *
 * For the same reason: do not return different error messages for "no such
 * user" vs "rate limited" vs other Supabase auth errors — keep responses
 * uniform.
 */
export async function sendMagicLink(formData: FormData): Promise<SendMagicLinkResult> {
  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string") {
    return { ok: false, error: "Please enter an email address." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const supabase = await createClient();

  // shouldCreateUser=true: lets Supabase create the auth.users row on first
  // signin so the handle_new_user() trigger fires. Whitelist check happens
  // when the user actually lands on /admin via requireAdmin().
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback`,
    },
  });

  if (error) {
    // Log but don't reveal — keep response uniform.
    console.error("[sendMagicLink] supabase error:", error.message);
  }

  // Always return "sent" regardless of underlying outcome — see comment above.
  return { ok: true, sent_to: email };
}
