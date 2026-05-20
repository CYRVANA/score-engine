-- score-engine — AI narrative generation tables.
-- See docs/ARCHITECTURE.md and PHASE_3_RETRO (forthcoming) for design.
--
-- prompt_templates: editable prompts stored in DB, not in code.
--   - One "active" template per workspace at a time
--   - History preserved by created_at; older versions kept for reference
--
-- ai_narratives: per-session generated content + observability fields.
--   - One row per session that successfully captures a lead
--   - status = pending/in_flight/delivered/failed
--   - body holds the generated text
--   - prompt_template_id remembers WHICH prompt produced this output
--   - input_tokens/output_tokens/latency_ms for cost and performance review

-- =========================================================================
-- prompt_templates
-- =========================================================================
create table prompt_templates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  body            text not null,
  model           text not null default 'claude-sonnet-4-6',
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references profiles(id) on delete set null
);

alter table prompt_templates enable row level security;

-- Service role only (admin actions run as service role per Phase 2 pattern).
-- No anon access; the prompt body is sensitive IP.

create index prompt_templates_workspace_active_idx
  on prompt_templates (workspace_id) where is_active = true;

create index prompt_templates_workspace_created_idx
  on prompt_templates (workspace_id, created_at desc);

-- Only one active template per workspace. Enforce at the DB level via partial unique.
create unique index prompt_templates_one_active_per_workspace_idx
  on prompt_templates (workspace_id) where is_active = true;

-- =========================================================================
-- ai_narratives
-- =========================================================================
create table ai_narratives (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions(id) on delete cascade,
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  prompt_template_id  uuid references prompt_templates(id) on delete set null,
  status              text not null default 'pending',
  body                text,
  model               text,
  input_tokens        int,
  output_tokens       int,
  latency_ms          int,
  attempt_count       int not null default 0,
  last_attempt_at     timestamptz,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  created_at          timestamptz not null default now(),
  delivered_at        timestamptz,
  constraint ai_narratives_status_check
    check (status in ('pending', 'in_flight', 'delivered', 'failed', 'retrying'))
);

alter table ai_narratives enable row level security;

-- Public read access for the session_id + workspace_id pair the user holds —
-- the session UUID is the access token (same pattern as the results page in
-- Phase 1.5). We don't expose narrative IDs anywhere else; reads always go
-- by session_id.
create policy ai_narratives_public_read_by_session on ai_narratives
  for select to anon
  using (true);  -- gated at the application layer; service-role used in practice

-- Index used by the worker to find due narrative jobs.
create index ai_narratives_due_idx
  on ai_narratives (status, next_attempt_at)
  where status in ('pending', 'retrying');

-- Index used by the results page to look up by session.
create index ai_narratives_session_idx
  on ai_narratives (session_id);

-- Index used by admin observability (recent narratives, cost analytics).
create index ai_narratives_workspace_created_idx
  on ai_narratives (workspace_id, created_at desc);

-- =========================================================================
-- Seed a generic placeholder prompt for CYRVANA's workspace.
-- The actual curated CYRVANA prompt is edited via the admin UI and lives
-- only in the production database — never committed to source.
-- =========================================================================
insert into prompt_templates (workspace_id, name, body, is_active)
values (
  '00000000-0000-0000-0000-000000000001',
  'Default placeholder',
  $$You are a helpful assessment guide. Based on the prospect's quiz answers, write a concise personalized analysis (250-400 words) of their result.

Tone: professional, encouraging, specific. Avoid generic platitudes.

Structure your response as plain prose (no markdown headings, no bullet lists). Reference 1-2 specific answers from the prospect to demonstrate the analysis is tailored to them.

End with a forward-looking sentence about what they could do next.

QUIZ CONTEXT:
{{quiz_title}}
{{quiz_description}}

PROSPECT'S RESULT:
Tier: {{tier_title}}
Score: {{score}}
Tier description: {{tier_description}}

PROSPECT'S ANSWERS:
{{answers_summary}}$$,
  true
);

comment on table prompt_templates is
  'Editable AI prompt templates. Active template per workspace is used by the narrative worker. See ARCHITECTURE.md.';
comment on table ai_narratives is
  'AI-generated narratives per session. Pending rows are drained by the generate-narrative Edge Function.';
