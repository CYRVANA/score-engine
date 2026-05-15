-- score-engine — initial schema
-- See docs/ARCHITECTURE.md §5 (Data Model) and §17 (Integrations).
-- Designed multi-tenant from day 1; v1 runs with a single workspace row.

create extension if not exists "pgcrypto"; -- for gen_random_uuid() and encrypted columns

-- =========================================================================
-- workspaces: the multi-tenant root. v1 has exactly one row.
-- =========================================================================
create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  plan        text not null default 'self',
  created_at  timestamptz not null default now()
);

-- =========================================================================
-- profiles: extends Supabase Auth identity with workspace + role.
-- One row per authenticated admin user. Public quiz takers are anonymous.
-- =========================================================================
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  email         text not null,
  role          text not null default 'member', -- 'admin' | 'member'
  created_at    timestamptz not null default now()
);

create index profiles_workspace on profiles(workspace_id);

-- =========================================================================
-- quizzes: scored assessments. Slug is unique within a workspace.
-- =========================================================================
create table quizzes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  slug          text not null,
  title         text not null,
  description   text,
  settings      jsonb not null default '{}'::jsonb,
  status        text not null default 'draft', -- 'draft' | 'published' | 'archived'
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index quizzes_workspace on quizzes(workspace_id);
create index quizzes_published on quizzes(status) where status = 'published';

-- =========================================================================
-- questions: ordered list per quiz. options is JSONB array.
-- Each option carries its own point value at submit time.
-- =========================================================================
create table questions (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references quizzes(id) on delete cascade,
  order_index  int not null,
  type         text not null default 'single_choice', -- single_choice | multi_choice | scale | text
  prompt       text not null,
  options      jsonb not null default '[]'::jsonb,
  weight       int not null default 1,
  created_at   timestamptz not null default now()
);

create index questions_quiz on questions(quiz_id, order_index);

-- =========================================================================
-- result_tiers: score buckets that map to a result page tier.
-- =========================================================================
create table result_tiers (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references quizzes(id) on delete cascade,
  min_score    int not null,
  max_score    int not null,
  title        text not null,
  description  text,
  cta_label    text,
  cta_url      text,
  created_at   timestamptz not null default now(),
  check (min_score <= max_score)
);

create index result_tiers_quiz on result_tiers(quiz_id);

-- =========================================================================
-- sessions: one row per quiz attempt. Decoupled from leads so we can
-- measure abandonment (sessions with no associated lead).
-- =========================================================================
create table sessions (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references quizzes(id) on delete cascade,
  lead_id         uuid, -- set after email gate; FK added below
  result_tier_id  uuid references result_tiers(id) on delete set null,
  score           int,
  metadata        jsonb not null default '{}'::jsonb, -- utm, referrer, device, geo
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index sessions_quiz on sessions(quiz_id);
create index sessions_completed on sessions(completed_at) where completed_at is not null;

-- =========================================================================
-- answers: one row per question answered in a session.
-- points is DENORMALIZED at submit time so historical scoring survives
-- later edits to questions/options.
-- =========================================================================
create table answers (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  question_id  uuid not null references questions(id) on delete cascade,
  value        jsonb not null, -- shape depends on question.type
  points       int not null default 0,
  created_at   timestamptz not null default now()
);

create index answers_session on answers(session_id);

-- =========================================================================
-- leads: captured at the email gate. Per §14.5 decision, INSERT per attempt
-- (no upsert) — retakes create new rows, linked by shared email.
-- =========================================================================
create table leads (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  quiz_id        uuid not null references quizzes(id) on delete cascade,
  session_id     uuid not null references sessions(id) on delete cascade,
  email          text not null,
  name           text,
  phone          text,
  custom_fields  jsonb not null default '{}'::jsonb, -- includes consent timestamp
  captured_at    timestamptz not null default now()
);

create index leads_workspace on leads(workspace_id);
create index leads_email on leads(workspace_id, lower(email));
create index leads_quiz on leads(quiz_id, captured_at desc);

-- Close the loop: sessions.lead_id references leads.
alter table sessions add constraint sessions_lead_fk
  foreign key (lead_id) references leads(id) on delete set null;

-- =========================================================================
-- destinations: typed adapters for shipping leads to HubSpot, generic
-- webhooks, etc. See ARCHITECTURE.md §17 for the adapter pattern.
-- =========================================================================
create table destinations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  quiz_id       uuid references quizzes(id) on delete cascade, -- null = all quizzes in workspace
  type          text not null, -- 'generic_webhook' | 'hubspot' | 'mailchimp' | ...
  name          text not null,
  config        jsonb not null, -- shape varies by type; credentials encrypted at rest
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index destinations_workspace_quiz on destinations(workspace_id, quiz_id) where active;

-- =========================================================================
-- destination_deliveries: outbox for the delivery worker.
-- =========================================================================
create table destination_deliveries (
  id              uuid primary key default gen_random_uuid(),
  destination_id  uuid not null references destinations(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  payload         jsonb not null,
  status          text not null default 'pending', -- pending | delivered | failed | auth_failed
  status_code     int,
  attempt_count   int not null default 0,
  external_id     text,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index destination_deliveries_pending
  on destination_deliveries(next_attempt_at)
  where status = 'pending';

create index destination_deliveries_lead
  on destination_deliveries(lead_id);

-- =========================================================================
-- updated_at trigger helpers
-- =========================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger quizzes_set_updated_at before update on quizzes
  for each row execute function set_updated_at();

create trigger destinations_set_updated_at before update on destinations
  for each row execute function set_updated_at();
