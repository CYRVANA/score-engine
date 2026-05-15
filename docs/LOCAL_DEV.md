# Local Development

## Prerequisites

- **Node.js 20+** — check with `node --version`
- **Docker Desktop** — Supabase CLI uses it to run a local Postgres
- **Supabase CLI** — `npm install -g supabase` or follow https://supabase.com/docs/guides/cli

## First-time setup

```bash
git clone <your-repo-url> score-engine
cd score-engine
npm install

# Copy env template and fill in values from your Supabase project
cp .env.example .env.local

# Start a local Supabase stack (Postgres, Auth, Storage) on Docker
supabase start

# Apply migrations + seed data
supabase db reset

# Regenerate TypeScript types from the live schema
npm run db:types

# Start Next.js
npm run dev
```

Open http://localhost:3000. You should see the CYRVANA landing page. Click "Try the demo quiz" — the page reads from your local Supabase and confirms RLS is wired correctly.

## What .env.local needs (for local dev)

Pull from `supabase start` output:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase start`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase start`>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`NEXT_PUBLIC_TERMLY_UUID` can be left blank locally — the banner renders nothing if unset.

## Common workflows

| Need | Command |
|---|---|
| Reset DB to clean state with seed | `supabase db reset` |
| Make a schema change | Create a new file in `supabase/migrations/`, then `supabase db reset` |
| Regenerate TS types after schema change | `npm run db:types` |
| Open Supabase Studio (DB GUI) | `http://127.0.0.1:54323` after `supabase start` |
| Stop the local stack | `supabase stop` |
| Lint, typecheck, build (what CI runs) | `npm run lint && npm run typecheck && npm run build` |

## Branching

`main` is protected. All work flows through PRs:

1. `git checkout -b feature/<short-name>`
2. Push and open a PR against `main`
3. CI runs lint + typecheck + build
4. Netlify creates a preview deploy at a unique URL
5. Merge → auto-deploys to `assess.cyrvana.com`
