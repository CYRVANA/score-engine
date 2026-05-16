-- score-engine — rate limiting for lead capture
-- See docs/ARCHITECTURE.md §8.
--
-- Counts attempts per (scope, key) bucket within a rolling time window.
-- For Phase 1.4 we use scope='lead_capture' and key=client IP.
--
-- This is intentionally simple: one row per attempt, plus a function that
-- counts recent rows and reports allow/deny. At small-enterprise scale (low
-- thousands of leads per month) a Postgres table is more than fast enough.
-- If we ever push past ~50 RPS sustained we'd swap in Upstash Redis.

create table rate_limits (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,        -- 'lead_capture', 'session_start', ...
  key         text not null,        -- IP address, or workspace_id, etc.
  attempted_at timestamptz not null default now()
);

-- Composite index supporting the rolling-window count query.
create index rate_limits_scope_key_time
  on rate_limits(scope, key, attempted_at desc);

-- Enable RLS. Anon/authenticated have no policies → no direct access.
-- All reads/writes flow through the service-role client in Server Actions.
alter table rate_limits enable row level security;

-- =========================================================================
-- check_rate_limit: atomic check-and-record.
-- Returns true if the attempt is allowed (and records it),
-- false if the limit has been exceeded (and does NOT record it).
-- =========================================================================
create or replace function check_rate_limit(
  p_scope        text,
  p_key          text,
  p_limit        int,
  p_window_secs  int
) returns boolean
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  select count(*)
    into v_count
    from rate_limits
   where scope = p_scope
     and key = p_key
     and attempted_at > now() - (p_window_secs || ' seconds')::interval;

  if v_count >= p_limit then
    return false;
  end if;

  insert into rate_limits(scope, key) values (p_scope, p_key);
  return true;
end;
$$;

-- =========================================================================
-- prune_rate_limits: housekeeping — remove rows older than the longest window.
-- Call from a cron job or as-needed. Not automated in v1; the table won't
-- grow large enough to matter for many months.
-- =========================================================================
create or replace function prune_rate_limits(p_older_than_secs int default 86400)
returns int
language plpgsql
security definer
as $$
declare
  v_deleted int;
begin
  delete from rate_limits
   where attempted_at < now() - (p_older_than_secs || ' seconds')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on table rate_limits is
  'Attempt log for the rate limiter. One row per attempted action. Pruned by prune_rate_limits().';
comment on function check_rate_limit is
  'Atomic rate-limit check. Returns true if attempt allowed (and records it); false if over limit. See ARCHITECTURE.md §8.';
