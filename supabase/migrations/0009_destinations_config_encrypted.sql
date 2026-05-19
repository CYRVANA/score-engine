-- score-engine — fix destinations.config column to match the encryption pattern.
-- Migration 0007 assumed a `config_encrypted` text column existed, but the
-- original schema (0001) created it as `config jsonb`. This migration aligns
-- the schema with what the code expects.
--
-- Safe to run: the destinations table has no rows yet at the time of this
-- migration (no destinations have been saved successfully). If you've added
-- rows since, run this only after confirming you can re-create them.

-- Drop the old column entirely; replace with the new one.
-- (Rename + type-change is awkward in Postgres; drop-and-recreate is cleaner
-- when there's no production data to preserve.)
alter table destinations
  drop column if exists config,
  drop column if exists config_encrypted;

alter table destinations
  add column config_encrypted text;

-- Make it nullable for now so existing rows (if any) don't error. The
-- application enforces presence at insert time.
comment on column destinations.config_encrypted is
  'pgp_sym_encrypt(JSONB::text, destination_secrets_key)::base64. Set via encrypt_destination_config(). See ARCHITECTURE.md §9.';
