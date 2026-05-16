-- score-engine — admin profile bootstrap
-- See docs/ARCHITECTURE.md §6 and PHASE_2_RETRO.md (forthcoming).
--
-- Whitelists a single admin user. When iatluri@cyrvana.com signs in via
-- magic link for the first time, Supabase Auth creates an auth.users row;
-- the trigger below auto-creates the matching profiles row scoped to the
-- CYRVANA workspace with role='admin'.
--
-- Adding more admins later (e.g. a co-admin) is a single INSERT — the schema
-- does not need to change.

-- =========================================================================
-- Whitelist table — which emails are allowed in, and what role they get.
-- =========================================================================
create table admin_whitelist (
  email         text primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  role          text not null default 'admin',
  created_at    timestamptz not null default now()
);

alter table admin_whitelist enable row level security;
-- No anon/authenticated policies — only service-role reads this table.
-- (Server Actions check the whitelist via the service-role client.)

-- Seed the CYRVANA admin.
insert into admin_whitelist (email, workspace_id, role) values
  ('iatluri@cyrvana.com', '00000000-0000-0000-0000-000000000001', 'admin');

-- =========================================================================
-- Trigger: when a new auth.users row is created (i.e. first magic-link signin),
-- look up the email in admin_whitelist and create a matching profiles row.
-- If the email isn't whitelisted, no profiles row is created — the user
-- can sign in to Supabase Auth but the app's requireAdmin() guard rejects them.
-- =========================================================================
create or replace function handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_role         text;
begin
  select workspace_id, role
    into v_workspace_id, v_role
    from admin_whitelist
   where lower(email) = lower(new.email);

  if v_workspace_id is not null then
    insert into profiles (id, workspace_id, email, role)
    values (new.id, v_workspace_id, new.email, v_role)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

comment on table admin_whitelist is
  'Allowlist of email addresses permitted to sign in as admins. Add a row to grant access; remove a row to revoke (after also deleting the corresponding profiles row).';
comment on function handle_new_user is
  'Auto-creates a profiles row on first signin if the user''s email is in admin_whitelist. See ARCHITECTURE.md §6.';
