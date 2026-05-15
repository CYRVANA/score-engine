# Deployment

End-to-end deployment of score-engine to https://assess.cyrvana.com.
Walk through these steps once for the first deploy; after that, pushing to `main` auto-deploys.

---

## 1. Create the Supabase project

1. Sign in to https://supabase.com → **New project**.
2. Name: `score-engine`. Region: closest to your users (US East works for Texas-based traffic).
3. Set a strong DB password and save it in your password manager.
4. Wait for provisioning (~2 minutes).
5. Note these from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Push migrations to Supabase

From a local clone of the repo:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies `0001_schema.sql`, `0002_rls.sql`, and `0003_seed.sql` to your hosted database.

Verify in the Supabase dashboard → **Table Editor** that you see `workspaces`, `quizzes`, `questions`, `result_tiers`, `sessions`, `answers`, `leads`, `destinations`, `destination_deliveries`, and `profiles`.

## 3. Create the Netlify site

1. Sign in to https://app.netlify.com → **Add new site → Import an existing project**.
2. Connect the GitHub repo for `score-engine`.
3. Build settings (auto-detected, but verify):
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Add environment variables (**Site settings → Environment variables**):
   - `NEXT_PUBLIC_SITE_URL` = `https://assess.cyrvana.com`
   - `NEXT_PUBLIC_SUPABASE_URL` = (from step 1)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (from step 1)
   - `SUPABASE_SERVICE_ROLE_KEY` = (from step 1)
   - `NEXT_PUBLIC_TERMLY_UUID` = (from step 5 below; leave blank for the first deploy if not ready)
5. **Deploy site**. First build takes ~2 minutes. Confirm the temp `<name>.netlify.app` URL loads the landing page.

## 4. Point Cloudflare DNS at Netlify

1. In Cloudflare → DNS for `cyrvana.com`:
   - Add a **CNAME** record:
     - Name: `assess`
     - Target: `<your-netlify-site>.netlify.app`
     - **Proxy status: DNS only (gray cloud) — NOT Proxied.** Cloudflare's proxy in front of Netlify breaks SSL unless you set up Full (strict) mode with custom cert chain; for v1 we don't need Cloudflare's CDN layer (Netlify already CDN-fronts everything).
2. In Netlify → **Domain settings → Add custom domain**:
   - Enter `assess.cyrvana.com`
   - Netlify auto-detects the DNS record and provisions a Let's Encrypt cert (~2 minutes).
3. Visit `https://assess.cyrvana.com`. Padlock should be valid.

## 5. Configure Termly for the subdomain

1. Sign in to https://app.termly.io.
2. Sidebar: **Consent Management → Consent Banner**.
3. Either:
   - **Easy path**: confirm whether your existing `cyrvana.com` Termly site already covers `assess.cyrvana.com` (many setups do automatically for same-root subdomains). If yes, reuse the same Website UUID.
   - **Clean path**: add `assess.cyrvana.com` as a new website in Termly. Requires a paid plan if you've outgrown the free tier's 1-site limit.
4. Configure the banner (cookies-only, opt-out, etc. — match what you do on cyrvana.com).
5. Click **Install → Embed**. Copy the `data-website-uuid="..."` value from the script.
6. Add to Netlify env vars: `NEXT_PUBLIC_TERMLY_UUID=<the-uuid>`.
7. Trigger a new Netlify deploy (push any commit, or **Deploys → Trigger deploy**).
8. Visit the site — banner should appear on first load.

## 6. Configure ZeptoMail for transactional email (Phase 2+)

Defer until Phase 2 (when results emails ship). Steps for future reference:

1. Sign in to Zoho → activate ZeptoMail (separate product from Zoho Mail).
2. **Mail Agents → Add Mail Agent → New domain**: `assess.cyrvana.com`.
3. ZeptoMail will give you SPF, DKIM, and DMARC DNS records.
4. Add them to Cloudflare DNS for `cyrvana.com` (records will be scoped to the `assess` subdomain).
5. Verify the domain in ZeptoMail.
6. Generate a Mail Agent token → add to Netlify env: `ZEPTOMAIL_TOKEN`.
7. Set `ZEPTOMAIL_SENDER=results@assess.cyrvana.com`.

## 7. Branch protection on GitHub

1. **Settings → Branches → Add branch protection rule** for `main`:
   - Require a pull request before merging
   - Require status checks to pass (select the `build` job from the CI workflow)
   - Require branches to be up to date before merging
   - Include administrators (yes — applies the rule to you too)
2. **Settings → Code security → Code scanning**: enable Dependabot alerts.
3. Update `.github/CODEOWNERS` to use your real GitHub handle.

---

## Verifying the deploy

After all steps:

- `https://assess.cyrvana.com` shows the CYRVANA landing page
- `https://assess.cyrvana.com/q/cyber-readiness` shows the demo quiz title and description (means RLS works for anonymous reads)
- `https://assess.cyrvana.com/q/does-not-exist` returns a Next.js 404
- The Termly cookie banner appears on first visit
- SSL padlock is valid

Phase 0 done. Phase 1 (real quiz renderer + lead capture) is the next deliverable.
