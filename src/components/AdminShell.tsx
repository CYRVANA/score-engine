import Link from "next/link";
import type { AdminProfile } from "@/lib/admin-auth";
import { isDestinationsEnabled } from "@/lib/feature-flags";

/**
 * Visual shell for protected admin pages: sidebar nav, user info, sign-out.
 *
 * Pure presentational — the auth guard (requireAdmin) runs in each page
 * server component and passes the resolved profile here. The login and
 * logout routes don't use this shell at all.
 */
export function AdminShell({
  profile,
  children,
}: {
  profile: AdminProfile;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Sidebar (desktop only for v1) */}
        <aside className="hidden w-64 flex-shrink-0 border-r border-border bg-navy-deep p-6 text-white sm:flex sm:flex-col">
          <div className="mb-10">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
              CYRVANA · Admin
            </p>
            <p className="mt-1 text-sm text-white/50">score-engine</p>
          </div>

          <nav className="flex-1 space-y-1">
            <NavLink href="/admin" label="Dashboard" />
            <NavLink href="/admin/leads" label="Leads" />
            <NavLink href="/admin/quizzes" label="Quizzes" />
            {isDestinationsEnabled() && (
              <NavLink href="/admin/destinations" label="Destinations" />
            )}
            <NavLink href="/admin/analytics" label="Analytics" badge="2.6" />
          </nav>

          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="mb-1 text-xs text-white/40">Signed in as</p>
            <p className="mb-4 truncate text-sm text-white/80">{profile.email}</p>
            <form action="/admin/logout" method="POST">
              <button
                type="submit"
                className="w-full rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/5"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {/* Mobile header — sidebar is desktop-only in v1 */}
          <header className="border-b border-border bg-background px-6 py-4 sm:hidden">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
                  CYRVANA · Admin
                </p>
                <p className="text-sm font-semibold text-foreground">score-engine</p>
              </div>
              <form action="/admin/logout" method="POST">
                <button
                  type="submit"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <div className="px-6 py-8 sm:px-10 sm:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, label, badge }: { href: string; label: string; badge?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5 hover:text-white"
    >
      <span>{label}</span>
      {badge && (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
          {badge}
        </span>
      )}
    </Link>
  );
}
