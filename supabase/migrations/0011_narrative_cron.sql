-- score-engine — pg_cron schedule for the AI narrative worker.
-- See docs/ARCHITECTURE.md for design.
--
-- Calls the Supabase Edge Function `generate-narrative` every minute.
-- The function drains pending ai_narratives rows by calling the Anthropic API.
--
-- Setup (one-time, run AFTER deploying the Edge Function):
--   1. pg_cron and pg_net already enabled by migration 0008
--   2. Replace __PROJECT_REF__ below with your Supabase project ref
--   3. Replace __SERVICE_ROLE_KEY__ with your project's service role key
--   4. Run this migration via Supabase Studio's SQL Editor

-- Unschedule any previous run with the same name (idempotent re-runs).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-narrative') then
    perform cron.unschedule('generate-narrative');
  end if;
end;
$$;

select cron.schedule(
  'generate-narrative',
  '*/1 * * * *',  -- every minute
  $$
  select net.http_post(
    url := 'https://__PROJECT_REF__.functions.supabase.co/generate-narrative',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
