-- score-engine — pg_cron schedule for the destinations outbox worker.
-- See docs/ARCHITECTURE.md §9.
--
-- This calls the Supabase Edge Function `process-deliveries` every 60 seconds.
-- The function drains pending destination_deliveries rows by calling the
-- appropriate destination adapter (HubSpot, etc.) and recording the result.
--
-- Setup notes (one-time, run AFTER deploying the Edge Function):
--   1. Enable pg_cron extension: already enabled by default on Supabase projects.
--   2. Replace <PROJECT_REF> below with your Supabase project ref.
--   3. Replace <SERVICE_ROLE_KEY> with your project's service role key.
--      You can use Supabase Vault to store this instead — see comments below.
--   4. Run this migration after applying via Studio's SQL editor or supabase db push.

create extension if not exists pg_cron;
create extension if not exists pg_net;  -- gives us net.http_post

-- Unschedule any previous run with the same name (idempotent re-runs).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-deliveries') then
    perform cron.unschedule('process-deliveries');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- IMPORTANT: before running this migration in production, replace the two
-- placeholders below. The recommended approach in Supabase 2026+ is to use
-- Vault for the service-role key. For now, the simplest path is to substitute
-- the literal values here once and never run this migration anywhere else
-- (which is true for production-only operational migrations — they don't
-- run on every developer's machine).
-- ----------------------------------------------------------------------------

select cron.schedule(
  'process-deliveries',
  '*/1 * * * *',  -- every minute
  $$
  select net.http_post(
    url := 'https://__PROJECT_REF__.functions.supabase.co/process-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

comment on extension pg_cron is 'Schedules background jobs in Postgres. See cron.job table for current schedule.';
