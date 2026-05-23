import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalAdmin } from "@/lib/admin-auth";
import { LoginForm } from "./LoginForm";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string }>;

/**
 * Magic-link login page at /admin/login.
 *
 * If the visitor is already signed in as an admin, redirect them to /admin
 * (no point making them sign in again).
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getOptionalAdmin();
  if (admin) {
    redirect("/admin");
  }

  const { error } = await searchParams;
  const errorMessage = errorMessageFor(error);

  return (
    <main className="relative min-h-screen overflow-hidden bg-navy-deep text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center top, rgba(236,98,2,0.12), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-brand">
              {brand.name} · Admin
            </p>
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            We&apos;ll email you a one-time link. No password required.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-red-300/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {errorMessage}
          </div>
        )}

        <LoginForm />

        <p className="mt-8 text-center text-xs text-white/40">
          <Link href="/" className="hover:text-white/70">
          ← Back to {brand.name}
          </Link>
        </p>
      </div>
    </main>
  );
}

function errorMessageFor(code: string | undefined): string | null {
  switch (code) {
    case "not_admin":
      return "That email is not authorized for admin access.";
    case "link_invalid":
      return "That sign-in link is invalid or has expired. Please request a new one.";
    default:
      return null;
  }
}
