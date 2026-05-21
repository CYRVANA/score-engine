import Link from "next/link";
import { brand } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-navy-deep text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(236,98,2,0.12), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-prose flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-brand">
          404 · Not found
        </p>
        <h1 className="mt-4 text-5xl font-bold leading-tight sm:text-6xl">
          That assessment isn&apos;t here.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-white/70">
          The quiz may have been unpublished, renamed, or never existed at this URL.
        </p>
        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition hover:bg-brand-600"
        >
          Back to {brand.name}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
