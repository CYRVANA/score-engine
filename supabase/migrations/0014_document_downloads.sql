-- score-engine — Phase 3c addendum: anonymous download event tracking.
-- See docs/ARCHITECTURE.md.
--
-- Logs every download (public and gated) for distribution analytics.
-- Public downloads are anonymous (lead_id NULL) — we capture referrer + UTMs
-- so you can see WHERE downloads come from without capturing WHO.
-- Gated downloads also record lead_id since the identity is known.
--
-- No PII for public downloads — only referrer, UTM tags, coarse user agent.

create table document_downloads (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  is_gated      boolean not null default false,
  lead_id       uuid references leads(id) on delete set null,  -- null for anonymous public
  referrer      text,         -- HTTP Referer header
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  user_agent    text,
  downloaded_at timestamptz not null default now()
);

create index document_downloads_doc_idx
  on document_downloads (document_id, downloaded_at desc);

create index document_downloads_workspace_idx
  on document_downloads (workspace_id, downloaded_at desc);

create index document_downloads_source_idx
  on document_downloads (workspace_id, utm_source);

alter table document_downloads enable row level security;

comment on table document_downloads is
  'Anonymous + identified download events for distribution analytics. Public downloads have lead_id NULL.';
