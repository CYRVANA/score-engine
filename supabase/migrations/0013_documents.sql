-- score-engine — Phase 3c: documents, direct-download lead capture, delivery tracking.
-- See docs/ARCHITECTURE.md for design.
--
-- Changes in this migration:
--   1. leads.quiz_id made nullable — direct-download leads have no quiz context.
--   2. documents — catalog of PDFs/assets with access level control.
--   3. tier_documents — join table attaching documents to result tiers.
--   4. document_access — one row per (lead, document) grant.
--   5. document_deliveries — outbox for HubSpot document-event updates.
--
-- Storage setup (manual, before using this migration):
--   Supabase Studio → Storage → New bucket:
--     1. "documents-public"   (public ON)
--     2. "documents-gated"    (public OFF)

-- ============================================================================
-- 1. Make leads.quiz_id and leads.session_id nullable
-- ============================================================================
-- Direct-download leads (/get/[slug]) have neither a quiz nor a session.
alter table leads
  alter column quiz_id drop not null;

alter table leads
  alter column session_id drop not null;

-- Rename cascade index so it reflects the new nullable semantics.
drop index if exists leads_quiz;
create index leads_quiz on leads (quiz_id, captured_at desc) where quiz_id is not null;

-- Separate index for direct-download leads (quiz_id IS NULL).
create index leads_direct on leads (workspace_id, captured_at desc) where quiz_id is null;

comment on column leads.quiz_id is
  'The quiz this lead came from. NULL for direct-download leads captured via /get/[slug].';
comment on column leads.session_id is
  'The quiz session. NULL for direct-download leads with no quiz session.';

-- ============================================================================
-- 2. documents
-- ============================================================================
create table documents (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  title                 text not null,
  slug                  text not null,
  description           text,
  storage_path          text not null,   -- relative path inside the bucket
  bucket                text not null,   -- "documents-public" or "documents-gated"
  access_level          text not null default 'email_gated'
    check (access_level in ('public', 'email_gated', 'paid')),
  is_direct_accessible  boolean not null default true,
  -- When true, the document is accessible via /get/[slug] with just email capture.
  -- When false, only accessible as a quiz tier result (not listed publicly).
  price_cents           int,
  stripe_price_id       text,  -- reserved for Phase 4
  is_active             boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index documents_workspace_slug_idx on documents (workspace_id, slug);
create index documents_workspace_active_idx on documents (workspace_id, is_active, sort_order)
  where is_active = true;

alter table documents enable row level security;

comment on table documents is
  'Catalog of downloadable assets. Access control via access_level + document_access grants.';

-- ============================================================================
-- 3. tier_documents — attach documents to result tiers
-- ============================================================================
create table tier_documents (
  tier_id      uuid not null references result_tiers(id) on delete cascade,
  document_id  uuid not null references documents(id) on delete cascade,
  sort_order   int not null default 0,
  primary key (tier_id, document_id)
);

create index tier_documents_tier_idx on tier_documents (tier_id, sort_order);

comment on table tier_documents is
  'Which documents are offered on which result tiers. Many-to-many.';

-- ============================================================================
-- 4. document_access — access grants per (lead, document)
-- ============================================================================
create table document_access (
  id                       uuid primary key default gen_random_uuid(),
  document_id              uuid not null references documents(id) on delete cascade,
  lead_id                  uuid not null references leads(id) on delete cascade,
  granted_at               timestamptz not null default now(),
  granted_by               text not null
    check (granted_by in (
      'quiz_result',       -- auto-granted on quiz email gate
      'direct_download',   -- submitted email on /get/[slug]
      'purchase',          -- Stripe payment (Phase 4)
      'manual'             -- admin granted manually
    )),
  stripe_payment_intent_id text,
  expires_at               timestamptz  -- null = permanent
);

-- A lead can only have one access grant per document.
create unique index document_access_lead_doc_idx
  on document_access (lead_id, document_id);

create index document_access_lead_idx on document_access (lead_id);
create index document_access_document_idx on document_access (document_id, granted_at desc);

alter table document_access enable row level security;

comment on table document_access is
  'Records which leads have access to which documents and how they earned it.';

-- ============================================================================
-- 5. document_deliveries — HubSpot outbox for document download events
-- ============================================================================
create table document_deliveries (
  id              uuid primary key default gen_random_uuid(),
  access_id       uuid not null references document_access(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  destination_id  uuid not null references destinations(id) on delete cascade,
  status          text not null default 'pending'
    check (status in ('pending', 'in_flight', 'delivered', 'failed', 'retrying')),
  attempt_count   int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  external_id     text,   -- HubSpot Contact ID after successful update
  created_at      timestamptz not null default now()
);

create index document_deliveries_due_idx
  on document_deliveries (status, next_attempt_at)
  where status in ('pending', 'retrying');

create index document_deliveries_lead_idx
  on document_deliveries (lead_id);

create index document_deliveries_access_idx
  on document_deliveries (access_id);

alter table document_deliveries enable row level security;

comment on table document_deliveries is
  'Outbox for HubSpot contact updates when a document is accessed. Drained by the process-deliveries Edge Function.';
