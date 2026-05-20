# Phase 2.5 Retrospective

> Date completed: 2026-05-19
> Phase scope: §9 and §17 of ARCHITECTURE.md — destinations + HubSpot adapter + outbox worker
> Author: Indy (with Claude as build pair)

---

## What shipped

A complete asynchronous lead-delivery pipeline:

- A `destinations` admin UI at `/admin/destinations`: create, configure, test, toggle active/inactive, delete
- HubSpot adapter: Private App token-based authentication, Contact upsert via the simple-create endpoint, automatic provisioning of five `score_engine_*` custom properties on Contacts (`score_engine_score`, `score_engine_tier`, `score_engine_quiz`, `score_engine_quiz_slug`, `score_engine_captured_at`)
- Generic webhook adapter (built alongside HubSpot since cost was near-zero)
- Outbox pattern: `captureLead` enqueues `destination_deliveries` rows; lead capture remains durable regardless of destination availability
- Supabase Edge Function `process-deliveries` running on a `pg_cron` schedule every 60 seconds, draining pending deliveries with exponential backoff on failures
- Encryption-at-rest for credentials: `pgcrypto`-based symmetric encryption of destination configs (HubSpot tokens, webhook secrets), keyed by `DESTINATION_SECRETS_KEY` env var
- Feature flag `FEATURE_DESTINATIONS` gating the entire destinations system, enabling future open-source/paid bifurcation without forking the codebase
- Delivery history visible in the admin UI with retry buttons for failed deliveries

End-to-end latency from lead capture to HubSpot Contact: ~30-60 seconds (one cron tick).

---

## What went well

- **The outbox pattern paid off immediately.** Even during this build, the value showed: a lead captured before the worker existed sat patiently in `destination_deliveries`, ready to deliver as soon as the worker came online. Lead capture itself was never blocked by destination-layer issues — and there were many destination-layer issues.

- **Feature flag was the right call.** Adding it cost ~30 lines and now the codebase is bifurcatable. If I ever decide to open-source, the destinations system disappears with one env var change. No regret, even if I never use it.

- **Architecture-first stayed valuable.** When the worker, encryption, scheduling, and admin UI all came together cleanly, it's because they were all designed against the same `destination_deliveries` schema and adapter interface. No re-architecting mid-build.

- **Defensive logging in the Edge Function helped diagnose.** The `console.error` and `console.log` statements I added made the difference between "the worker is broken" and "the worker can't decrypt because the key is missing from the Edge Function env." Worth the line count.

- **Two adapters shipped, not one.** Building HubSpot revealed that the generic webhook adapter was 30 additional lines. Now CYRVANA has the flexibility to point at Zapier, Make.com, n8n, or any custom endpoint without further code. Future-proofing came essentially free.

## What went wrong (the painful parts)

This was the most error-prone phase of the project so far. The bugs weren't conceptual; they were "didn't carefully cross-check the existing schema before writing new code" bugs. Three rounds of avoidable rework:

- **`is_active` vs `active` mismatch.** Migration 0007 referenced `destinations.is_active` in two indexes. The original schema (0001) had created the column as `active`. I assumed without checking. SQL error `42703: column "is_active" does not exist` on a migration that should have run silently. Cost: one rebuild cycle.

- **`set_config` ownership collision.** Migration 0007 tried to `create or replace function set_config(...)` — but `set_config` is a Postgres built-in owned by the `postgres` role, not `postgres_admin`. The supabase service role can't replace it. Error: `42501: must be owner of function set_config`. Worse, the implementation I wrote was recursive — calling `set_config()` inside `set_config()` — which would have stack-overflowed if it had been allowed to run. Fix: rename the wrapper to `set_destination_secrets_key` to avoid the collision, and have the body call Postgres's built-in `set_config` correctly. Cost: another rebuild cycle.

- **`config_encrypted` column didn't exist.** The Server Action and Edge Function both wrote to `destinations.config_encrypted` (a text column), but the original schema had created the column as `config` (jsonb). Migration 0007 added new columns but didn't fix this one. PostgREST error: `Could not find the 'config_encrypted' column of 'destinations' in the schema cache`. Required a fourth migration (0009) to drop the old column and add the right one. Cost: a third rebuild cycle, plus a re-saved destination.

The common thread: **I wrote 2.5 against the schema I remembered, not the schema that actually existed.** A 5-minute pass through `0001_schema.sql` before writing 0007 would have caught all three. This is the single highest-leverage process change for any future schema-touching work.

## What surprised me

- **pg_cron + pg_net "succeeded" doesn't mean the HTTP request reached its target.** `cron.job_run_details.status = 'succeeded'` only confirms that pg_net successfully queued the HTTP call. The actual HTTP response is logged separately in `net._http_response`. We chased the wrong layer for two diagnostic rounds because we trusted "succeeded" at face value. Lesson for future: always cross-check `net._http_response` when debugging async HTTP-based work.

- **The empty-string substitution gotcha bit me hard.** When manually editing migration 0008's placeholders (`__PROJECT_REF__` and `__SERVICE_ROLE_KEY__`), I substituted the project ref with an empty string by accident. The resulting URL `https://.functions.supabase.co/process-deliveries` is syntactically valid but unresolvable. Postgres accepted the cron schedule without complaint. We only caught it from "Couldn't resolve host name" errors in `net._http_response` after a long detour. Lesson: for any hand-edited placeholder, do a visual scan of the final string and run a quick query (`select * from cron.job`) to verify the substitution before walking away.

- **HubSpot Private Apps survive UI shuffles.** When I tried to walk Indy through "Account & Billing → Integrations → Private Apps", the menu didn't exist there in current HubSpot. The actual path is gear icon → Settings → left sidebar → Integrations → Private Apps. HubSpot has shuffled this UI several times. Lesson: don't hard-code SaaS UI paths in docs; describe destinations by name (the menu item you're looking for) and let users find their way through current navigation.

- **The HubSpot custom-properties auto-provisioning was the most elegant decision.** First-time destination save auto-creates the `score_engine_*` properties on Contacts. Idempotent (re-running is safe). No manual HubSpot setup. This was originally going to be "ask the user to create these properties first" in the docs; building it into the adapter made the integration genuinely zero-touch. Will reuse the pattern for any future destination adapter.

- **"All contacts" vs "My contacts" filter in HubSpot.** API-created contacts aren't assigned to anyone and don't show in the default "My contacts" view. Easy to think "the integration is broken" when actually the integration worked perfectly and the UI is just hiding the result. Worth knowing.

## What I'd do differently

- **Cross-check existing schema before writing new migrations.** Single biggest leverage point. Every new migration should start with `cat supabase/migrations/0001_schema.sql | grep <table>` to confirm column names and types. Same applies for `is_active`-style naming conventions across the project.

- **Never shadow Postgres built-ins.** Even with `security definer`. Postgres has hundreds of built-in function names; even non-obvious ones (`set_config`) are reserved-ish. Default to prefixing custom functions with a project-specific prefix (`score_engine_`, `destination_`, etc.) to eliminate the entire class of collision.

- **Use Supabase Vault for secrets instead of placeholders in migrations.** Migration 0008's `__SERVICE_ROLE_KEY__` placeholder is functional but error-prone (the empty-string substitution gotcha). Supabase Vault provides a built-in way to store secrets and reference them in SQL without hardcoding. Would have avoided the empty-string issue and made rotation cleaner.

- **Add a "post-migration smoke test" pattern.** Each new migration should have a corresponding tiny SQL query that verifies it applied correctly — column exists, function exists, index exists. Run it after every migration. Would have caught the column-rename + schema-mismatch issues in seconds instead of minutes.

- **Don't hand-edit cron schedules; manage them via migration files only.** When the cron URL was wrong (empty project ref), I rescheduled it directly in the SQL Editor with a hand-written `cron.unschedule` + `cron.schedule` call. That's now out of sync with what's in the repo's `0008_outbox_cron.sql`. If I ever rebuild this database from scratch (or migrate), the live cron has drifted from source. Lesson: always re-apply migration files; don't make schema changes outside migrations.

## Content quality lessons (not strictly Phase 2.5, but discovered during it)

While testing the HubSpot integration end-to-end, I submitted real test leads through the funnel multiple times. A few observations about the seed Cyber Readiness Assessment that were noticed in passing:

- The CTA URLs on the result tiers all point to cyrvana.com placeholder pages. Real CTAs should point to a meeting link (Calendly, HubSpot meetings) for the most-qualified tier and to specific service pages for the others.
- The `score_engine_*` properties land in HubSpot but aren't yet wired to any automation. The next high-leverage thing in HubSpot (separate from score-engine) is to build a workflow that triggers on `score_engine_tier = "Foundational"` to send sales a notification.
- The quiz title "Cyber Readiness Assessment" is descriptive but generic. A more specific framing tied to a concrete outcome (e.g. "How prepared are you for a SOC 2 audit?") would likely convert better. Worth A/B testing once we have real traffic data.

## Status of the architecture doc

`ARCHITECTURE.md` still holds up. A few additions to make on the next pass:

- §9: add the empty-string substitution lesson as a footnote on the `pg_cron` example
- §9: update the function name from the original "set_config" to "set_destination_secrets_key"
- §17: note the auto-provisioning behavior of the HubSpot adapter
- New section on feature flags: the pattern, how to add a new one, when to gate a feature

These aren't blocking; the doc is still a good source of truth.

## Open items for Phase 2.6 and beyond

- **Phase 2.6 (analytics) starts next.** Smallest piece of Phase 2 left.
- **The `parent_id` quiz field for cloned variants is in the schema but unused in analytics yet.** When 2.6 ships, would be nice to aggregate metrics across a parent quiz and its sector variants.
- **The destination deliveries table will grow without bounds.** At small scale this is fine; once we have thousands of leads/month, a TTL policy or archive table would keep query performance predictable.
- **`pg_cron` is the only place using server-side timers in this project.** If we ever add more cron jobs (e.g. email digests, lead recycling, AI-result-narrative generation), worth documenting the pattern and consolidating in one place.

## TL;DR

Phase 2.5 shipped: leads now flow automatically to HubSpot within ~60 seconds of capture. The bugs we hit were 100% "I forgot to check what schema already existed" mistakes — none were design flaws. Three rebuild cycles is too many for a piece this size; the process fix is "audit existing schema before writing new migrations." Worth it; the funnel-to-CRM automation was the biggest single unblocker for actually running CYRVANA campaigns at scale.
