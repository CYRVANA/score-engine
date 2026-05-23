/**
 * Brand config — reads from environment variables so any deployment can
 * customize without touching source code.
 *
 * All NEXT_PUBLIC_ vars are inlined at build time by Next.js and available
 * in both server and client components. Non-NEXT_PUBLIC_ vars (used only
 * server-side or in Edge Functions) are read directly via process.env.
 *
 * ─── Required env vars for a production deployment ───────────────────────
 *   NEXT_PUBLIC_SITE_URL      The deployed base URL, e.g. https://assess.acme.com
 *
 * ─── Optional brand env vars (sensible defaults for local dev) ───────────
 *   NEXT_PUBLIC_APP_NAME      Display name, e.g. "Acme Assessments"
 *   NEXT_PUBLIC_APP_TAGLINE   Hero tagline on the homepage
 *   NEXT_PUBLIC_WEBSITE_URL   Company website linked from footer/results
 *   NEXT_PUBLIC_PRIVACY_URL   Privacy policy URL linked from consent copy
 *   NEXT_PUBLIC_CONTACT_EMAIL Shown in email footer as the reply-to contact
 *
 * ─── CYRVANA deployment values (set in Netlify env vars) ─────────────────
 *   NEXT_PUBLIC_APP_NAME=CYRVANA Assessments
 *   NEXT_PUBLIC_APP_TAGLINE=Know your risk. Start the conversation.
 *   NEXT_PUBLIC_WEBSITE_URL=https://cyrvana.com
 *   NEXT_PUBLIC_PRIVACY_URL=https://cyrvana.com/privacy
 *   NEXT_PUBLIC_CONTACT_EMAIL=info@cyrvana.com
 *
 * ─── Community self-hosted defaults (what you get with no env vars set) ──
 *   App name:    "score-engine"
 *   Tagline:     "Assess. Score. Engage."
 *   Website URL: (empty — footer link hidden)
 *   Privacy URL: (empty — consent copy uses generic text)
 */

export const brand = {
  /** Display name shown in page titles, nav, emails, and consent copy. */
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "score-engine",

  /** One-line tagline for the homepage hero. */
  tagline: process.env.NEXT_PUBLIC_APP_TAGLINE ?? "Assess. Score. Engage.",

  /** The deployed base URL. Used for canonical URLs and email links. */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),

  /** Company website. If empty, the footer website link is hidden. */
  websiteUrl: process.env.NEXT_PUBLIC_WEBSITE_URL ?? "",

  /** Privacy policy URL. If empty, consent copy uses a generic fallback. */
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL ?? "",

  /** Contact email shown in email footers. Falls back to empty string. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
} as const;
