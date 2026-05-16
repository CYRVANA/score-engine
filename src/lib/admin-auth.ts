import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminProfile = {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
};

/**
 * requireAdmin: server-side guard for /admin/* pages.
 *
 * - If no Supabase Auth session → redirect to /admin/login
 * - If session exists but no profiles row (i.e. email not whitelisted) →
 *   sign out + redirect to /admin/login?error=not_admin
 * - Otherwise → return the profile
 *
 * Call this at the top of every protected admin page or layout.
 */
export async function requireAdmin(): Promise<AdminProfile> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, workspace_id, email, role")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.role !== "admin") {
    // Authenticated to Supabase but not an admin in our app.
    // Sign them out of the Supabase session so subsequent visits go through login again.
    await supabase.auth.signOut();
    redirect("/admin/login?error=not_admin");
  }

  return profile;
}

/**
 * getOptionalAdmin: same as requireAdmin but returns null instead of redirecting.
 * Used by the login page itself, which redirects already-signed-in users
 * AWAY from the login form to /admin.
 */
export async function getOptionalAdmin(): Promise<AdminProfile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, workspace_id, email, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") return null;
  return profile;
}
