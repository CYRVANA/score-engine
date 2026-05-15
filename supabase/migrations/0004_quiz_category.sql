-- score-engine — add category and sibling-grouping fields for sector variants
-- See docs/ARCHITECTURE.md §5 and the "sector variants" decision (2026-05-15).
--
-- Adds:
--   category      — topic grouping (e.g. "Cyber Readiness", "Vendor Risk")
--   segment       — audience tag (e.g. "Healthcare", "Manufacturing", "Finance")
--   parent_id     — self-reference for "this is a variant of that quiz"
--   archived_at   — soft-archive timestamp (complements status='archived')
--
-- All fields are nullable so existing quizzes (the seed) remain valid.

alter table quizzes
  add column category    text,
  add column segment     text,
  add column parent_id   uuid references quizzes(id) on delete set null,
  add column archived_at timestamptz;

-- Index for admin UI: "list all variants of <category>"
create index quizzes_workspace_category on quizzes(workspace_id, category) where category is not null;

-- Index for variant tree lookups: "list all variants of this parent quiz"
create index quizzes_parent on quizzes(parent_id) where parent_id is not null;

-- Backfill the seed quiz with category + segment so the admin UI has a sensible default.
update quizzes
   set category = 'Cyber Readiness',
       segment  = 'General'
 where slug = 'cyber-readiness'
   and workspace_id = '00000000-0000-0000-0000-000000000001';

-- Useful comment for future readers
comment on column quizzes.category is
  'Topic grouping. Quizzes sharing a category are conceptually related (e.g. all "Cyber Readiness" variants).';
comment on column quizzes.segment is
  'Audience tag for a sector/industry variant (e.g. "Healthcare", "Manufacturing"). NULL or "General" for non-segmented quizzes.';
comment on column quizzes.parent_id is
  'Optional self-reference. Set on variant quizzes to point at the canonical/original quiz they derive from. Lets the admin UI render variant trees.';
comment on column quizzes.archived_at is
  'Soft-archive timestamp. Set when status transitions to "archived". Distinct columns so we can later add "scheduled archive" without losing the moment status changed.';
