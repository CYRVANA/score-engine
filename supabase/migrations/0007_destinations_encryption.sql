-- score-engine — destinations encryption + delivery tracking
-- See docs/ARCHITECTURE.md §9 and §17.

-- =========================================================================
-- pgcrypto for symmetric encryption of destination configs.
-- =========================================================================
create extension if not exists pgcrypto;

-- =========================================================================
-- destinations: tighten + add columns 2.5 needs.
-- The base table exists from migration 0001; this adds columns and indexes.
-- =========================================================================
alter table destinations
  add column if not exists last_test_at      timestamptz,
  add column if not exists last_test_status  text,
  add column if not exists last_test_error   text;

-- Make sure the active+type lookup the worker does is cheap.
create index if not exists destinations_workspace_active_idx
  on destinations (workspace_id, active) where active = true;

create index if not exists destinations_quiz_active_idx
  on destinations (quiz_id, active) where quiz_id is not null and active = true;

-- =========================================================================
-- destination_deliveries: add columns needed for retry tracking and
-- visibility in the admin UI.
-- =========================================================================
alter table destination_deliveries
  add column if not exists attempt_count    int  not null default 0,
  add column if not exists last_attempt_at  timestamptz,
  add column if not exists next_attempt_at  timestamptz not null default now(),
  add column if not exists last_error       text,
  add column if not exists external_id      text;  -- HubSpot Contact ID after success

-- Index used by the worker to pull pending work.
create index if not exists destination_deliveries_due_idx
  on destination_deliveries (status, next_attempt_at)
  where status in ('pending', 'retrying');

-- Index used by the admin UI to show deliveries for a destination.
create index if not exists destination_deliveries_destination_created_idx
  on destination_deliveries (destination_id, created_at desc);

-- Index used by the admin UI to show deliveries for a lead.
create index if not exists destination_deliveries_lead_idx
  on destination_deliveries (lead_id);

-- =========================================================================
-- Encryption helpers.
-- These wrap pgcrypto's pgp_sym_encrypt/decrypt so the worker and the
-- Server Actions use the same key handling. The key is supplied via the
-- Supabase Vault or via the `app.destination_secrets_key` GUC; we read it
-- via current_setting which lets us pass the key into the SQL session.
--
-- Production setup: the Edge Function and Server Actions both call
-- `set_config('app.destination_secrets_key', '<key>', false)` at start of
-- their database connection, then call these helpers without passing the
-- key explicitly. This keeps the key out of query strings (which could
-- be logged) and out of insert/update statements.
-- =========================================================================

-- Encrypt a JSONB value to a bytea blob.
create or replace function encrypt_destination_config(plain jsonb)
returns text
language plpgsql
security definer
as $$
declare
  k text;
begin
  k := current_setting('app.destination_secrets_key', true);
  if k is null or k = '' then
    raise exception 'destination_secrets_key not set on this session';
  end if;
  return encode(pgp_sym_encrypt(plain::text, k), 'base64');
end;
$$;

create or replace function decrypt_destination_config(cipher text)
returns jsonb
language plpgsql
security definer
as $$
declare
  k text;
begin
  k := current_setting('app.destination_secrets_key', true);
  if k is null or k = '' then
    raise exception 'destination_secrets_key not set on this session';
  end if;
  return pgp_sym_decrypt(decode(cipher, 'base64'), k)::jsonb;
end;
$$;

comment on function encrypt_destination_config is
  'Encrypts a JSONB config under the session-set destination_secrets_key. See ARCHITECTURE.md §9.';
comment on function decrypt_destination_config is
  'Decrypts a config encrypted by encrypt_destination_config. See ARCHITECTURE.md §9.';

-- =========================================================================
-- set_destination_secrets_key RPC.
-- The Supabase JS client doesn't expose Postgres's set_config directly,
-- and we can't shadow the built-in with our own set_config (it's owned
-- by the postgres role). This wrapper takes only the value, sets the
-- specific GUC we need, and is safe to expose to the service-role client.
-- =========================================================================
create or replace function set_destination_secrets_key(value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.destination_secrets_key', value, false);
end;
$$;

comment on function set_destination_secrets_key(text) is
  'Sets the destination_secrets_key GUC on the current session so encrypt/decrypt helpers can use it. Called by the Server Actions and Edge Function at start of every request.';
