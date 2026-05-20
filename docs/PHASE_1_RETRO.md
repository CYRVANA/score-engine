# Phase 1 Retrospective

> Date completed: 2026-05-16
> Phase scope: §16 of ARCHITECTURE.md, Phase 1 — public quiz funnel with lead capture
> Author: Indy (with Claude as build pair)

---

## What shipped

A fully working lead-generation funnel at `https://assess.cyrvana.com`:

- Multi-step quiz renderer with progress, navigation, required-answer validation, Previous/Next
- Authoritative server-side scoring (client never trusted with points)
- Session and answer persistence to Supabase
- Branded email gate with name + email + consent + honeypot
- Anti-abuse: IP-based rate limiting (5/10min), disposable-domain blocklist, honeypot logging
- Lead capture writing to `leads` with workspace-scoped writes
- Bookmarkable results page with score, tier, full description, CTA, and answer breakdown
- Branded 404 for invalid sessions and unknown routes
- CI/CD: GitHub → CI lint+typecheck+build → Netlify auto-deploy on `main`

Total infrastructure cost at launch: $0/mo (Supabase free, Netlify free).

---

## What went well

- **Architecture-first paid off.** The decision to write a complete `ARCHITECTURE.md` before any code meant every Phase 1 piece slotted into a known place. Five sub-pieces (renderer → scoring → gate → capture → results) each had a clear contract with the next.
- **Multi-tenant schema from day 1 cost almost nothing.** Every tenant table has `workspace_id`. v1 runs with a single workspace row. The day we want to go multi-tenant, no migrations rewrite anything.
- **Service-role for writes, anon for reads** is a clean security boundary. Anonymous quiz takers never had RLS write access to sensitive tables; all writes went through Server Actions with the service-role key. Made the rate-limiter, captureLead, and results-page reads all reason about cleanly.
- **Outbox pattern designed in early** even though we didn't build it. When Phase 2 adds the HubSpot adapter, there's a clear, well-thought-out place for it.
- **Piece-by-piece pacing.** Five separate deploys with tests in between meant each broken state was small and quickly correctable. The "one weekend" goal hit on the nose.
- **The seed quiz was real, not a stub.** The Cyber Readiness Assessment with 5 real questions, 3 real tiers, and CTA URLs pointing at cyrvana.com services was rendering correctly the moment Phase 0 went live. Made every subsequent test feel like real product work, not a demo.

## What surprised me

- **GitHub's web UI is hostile to dot-folders and bracketed paths.** Drag-and-drop silently drops `.github/` and `[slug]/` — files just don't appear in the commit. The path-typing trick (Add file → Create new file → type the full slashed path) works but is non-obvious. GitHub Desktop or the command line avoids the problem entirely; worth the 10-minute install.
- **Supabase embed types widen unpredictably.** Sometimes a one-to-one embed comes back as an object, sometimes as a single-element array, sometimes the TypeScript types differ from the runtime shape. Defensive `Array.isArray(x) ? x[0] : x` handling was needed in multiple places. The pattern only became obvious after the third instance broke a build.
- **TypeScript strict mode caught real bugs but required discipline.** Every standalone callback parameter needs an explicit type or the build fails. Two separate Phase 1 deploys broke on this. Painful in the moment, but each one was a real bug that strict mode caught early.
- **The RLS gotcha on results page** was the hardest single bug. The page used the regular (anon) Supabase client, and the `sessions` table's RLS policy required an authenticated workspace member. Anonymous takers got zero rows back. The error was PostgREST returning "Cannot coerce the result to a single JSON object" — a code (PGRST116) that doesn't immediately scream "RLS." Lesson: every server-rendered route that reads tenant data needs to consciously decide between anon-client + RLS vs service-role + manual access checks. I should document this as a checklist in `ARCHITECTURE.md`.
- **Cloudflare proxy on Netlify subdomains breaks SSL.** Always set the proxy to "DNS only" (gray cloud), not Proxied (orange). One-time pain; documented now in `DEPLOYMENT.md`.

## What I'd do differently

- **Pick GitHub Desktop or CLI on day one.** Web UI for routine commits is a false economy — every multi-file change wasted minutes on path-typing or missing dot-folders.
- **Run the build locally once before the first push.** Two of the deploy failures were strict-mode TypeScript errors that `npm run typecheck` would have caught instantly. Add it to my pre-push reflex.
- **Add an RLS-vs-service-role decision matrix to ARCHITECTURE.md.** For every new server-rendered route, the first question is "who reads this — anon or authenticated?" Codifying it would have caught the results-page bug at design time.
- **Add `npm run preview` (or equivalent) to docs/LOCAL_DEV.md.** Once I had Phase 0 live on Netlify previews, I stopped running anything locally. That worked but meant every iteration cycle was a 2-minute Netlify build. Running locally would have been faster for iteration cycles where I knew the deploy would succeed.

## Content gaps in the seed quiz

The Cyber Readiness questions are *fine* as a demo but weak as a real lead magnet:

- Five questions is too few for the result to feel earned. ScoreApp benchmark is 8–12.
- "Foundational/Developing/Mature" tiering is too generic. The tier descriptions should hint at *specific next actions* per tier, not just describe the current state.
- The CTAs all point at cyrvana.com/services/* pages — fine for a placeholder, but the highest-converting move is probably "Book a 15-minute call" linking to a Calendly or HubSpot meeting link.
- No segment-specific copy. For Phase 2, sector variants (healthcare, manufacturing, finance) will need rewritten questions, not just relabeled tiers.

Don't ship the seed quiz as the production lead magnet. Use it to prove the engine works, then write proper content. Probably an afternoon of focused thinking with a vCISO subject-matter hat on.

## Architecture decisions I'd revisit

Reading ARCHITECTURE.md after building the thing, most decisions hold up. A few I'd revisit:

- **§4 rendering plan for `/q/[slug]`**: doc says ISR with 60s revalidate, but I ended up forcing dynamic because the page starts a session on every visit. ISR doesn't help when every render needs a fresh side effect. I should update the doc to reflect what we actually shipped.
- **§9 "outbox pattern" for destinations**: the architecture describes a Postgres trigger or explicit Server Action call inserting `destination_deliveries` rows. Phase 1 doesn't have this yet (no destinations to deliver to). Phase 2 will need to decide: do we enqueue from `captureLead`, or do we use a Postgres trigger so the enqueue happens automatically on lead insert? I lean trigger for reliability, but it adds operational complexity.
- **§17 HubSpot adapter "Phase 2"**: the doc lumps the HubSpot adapter together with the admin UI as one phase. In practice they're independent — the adapter can ship before the admin UI (configured via SQL initially), and that's probably the right call given how much higher-leverage CRM integration is than UX polish.

## Status of the architecture doc

`ARCHITECTURE.md` is still the source of truth, but a few sections need updates after Phase 1:

- §4: rendering plan should reflect "force-dynamic" on quiz pages
- §6: add the RLS-vs-service-role decision checklist for server-rendered routes
- §16: tick off Phase 1's checkboxes
- §17: confirm HubSpot adapter can ship independently of admin UI

These aren't blocking — the doc is good — but the next time I make non-trivial changes I should refresh them.

## Open questions for Phase 2

- Do we author the admin UI auth flow now (Supabase magic links) or punt until Phase 4 multi-tenant?
- Do we add `category` and `segment` filters to the admin quiz list now, or wait until there are actually multiple sector variants?
- HubSpot Private App token: rotate quarterly? Set an expiration in HubSpot itself? Worth defining the rotation procedure before the integration goes live.
- Do we add an analytics dashboard in Phase 2, or rely on raw SQL queries against `sessions`/`leads` until we feel the pain?

## TL;DR

Phase 1 shipped. The funnel works. The architecture decisions made up front paid off — every piece slotted into a designed slot. The bugs we hit were 90% rendering/tooling friction (web UI, embed types, RLS policies on a route I forgot to think about) and 10% genuine logic issues — all caught and fixed within hours. Costs are $0/mo. Ready for real campaigns now; Phase 2 makes operating it much pleasanter.
