# score-engine

A self-hosted lead-generation quiz platform for cybersecurity consultancies and MSPs. Capture qualified leads through scored assessments, deliver results to your CRM, and generate AI-personalized analysis for every prospect.

Built and used in production by [CYRVANA](https://cyrvana.com).


## What it does

- **Public quiz funnel** — multi-step assessments with scoring, tier results, and a bookmarkable results page
- **Lead capture** — email gate with honeypot, rate limiting, and disposable-domain blocking
- **Admin dashboard** — leads viewer, CSV export, full quiz builder, funnel analytics
- **CRM delivery** — HubSpot adapter with outbox worker; generic webhook for everything else
- **AI narratives** — Anthropic-powered personalized result analysis on the results page
- **Email delivery** — branded result emails via Resend after narrative generation

## Stack

- **Frontend**: Next.js 15 App Router + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Postgres + Auth + RLS + Edge Functions)
- **Hosting**: Netlify
- **Email**: Resend (optional)
- **AI**: Anthropic Claude API (optional)

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/CYRVANA/score-engine.git
cd score-engine
npm install
```

### 2. Set up Supabase

Create a new Supabase project then run migrations in order via Supabase Studio → SQL Editor:

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_rls.sql
supabase/migrations/0003_seed.sql        ← edit workspace name before running
supabase/migrations/0004_quiz_category.sql
supabase/migrations/0005_rate_limits.sql
supabase/migrations/0006_admin_profile.sql   ← edit your admin email before running
```

Migrations 0007–0012 are for optional features (destinations, AI, email). Apply them only when enabling the corresponding feature flag.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

Brand (customize to your organization):
```
NEXT_PUBLIC_APP_NAME=Your Company Assessments
NEXT_PUBLIC_WEBSITE_URL=https://your-company.com
NEXT_PUBLIC_PRIVACY_URL=https://your-company.com/privacy
NEXT_PUBLIC_CONTACT_EMAIL=hello@your-company.com
```

### 4. Run locally

```bash
npm run dev
```

Landing page: `http://localhost:3000`  
Admin: `http://localhost:3000/admin`

### 5. Configure admin access

The admin dashboard uses magic-link auth. Edit `supabase/migrations/0006_admin_profile.sql`, replace the placeholder email with yours, then run the migration. Sign in at `/admin/login` to receive your magic link.

## Feature flags

All optional features default to **off**. Enable them by setting the env var to `"true"`.

| Flag | Feature | Additional requirements |
|---|---|---|
| `FEATURE_DESTINATIONS` | HubSpot + webhook delivery | `DESTINATION_SECRETS_KEY` + `process-deliveries` Edge Function |
| `FEATURE_AI_NARRATIVES` | AI personalized narratives | `ANTHROPIC_API_KEY` + `generate-narrative` Edge Function |
| `FEATURE_EMAIL_NARRATIVES` | Email delivery via Resend | `RESEND_API_KEY` + `FEATURE_AI_NARRATIVES=true` |

See `.env.example` for full configuration reference.

## Deploying

### Netlify

Connect your repo to Netlify, set environment variables, and deploy. The `netlify.toml` is pre-configured.

### Edge Functions

```bash
supabase login
supabase link --project-ref your-project-ref

# If FEATURE_DESTINATIONS=true:
supabase functions deploy process-deliveries

# If FEATURE_AI_NARRATIVES=true:
supabase functions deploy generate-narrative
```

Set required secrets in Supabase Studio → Edge Functions → Manage secrets.

## Project structure

```
src/
  app/
    page.tsx              Public landing page (dynamic quiz list)
    q/[slug]/             Public quiz funnel + results
    admin/                Admin dashboard (auth-gated)
  components/             Shared UI components
  lib/
    brand.ts              Brand config (env-var driven, no hardcodes)
    feature-flags.ts      Feature flag helpers
    analytics.ts          Funnel metrics
    scoring.ts            Quiz scoring logic
supabase/
  migrations/             Schema — run in numbered order
  functions/
    process-deliveries/   CRM delivery worker
    generate-narrative/   AI narrative + email worker
```

## License

[MIT](LICENSE) — © 2026 CYRVANA. Built in production at [assess.cyrvana.com](https://assess.cyrvana.com).
