-- score-engine — Row Level Security policies
-- See docs/ARCHITECTURE.md §6.

-- Enable RLS on every tenant table.
alter table workspaces                enable row level security;
alter table profiles                  enable row level security;
alter table quizzes                   enable row level security;
alter table questions                 enable row level security;
alter table result_tiers              enable row level security;
alter table sessions                  enable row level security;
alter table answers                   enable row level security;
alter table leads                     enable row level security;
alter table destinations              enable row level security;
alter table destination_deliveries    enable row level security;

-- =========================================================================
-- Helper: current user's workspace
-- =========================================================================
create or replace function current_workspace_id() returns uuid as $$
  select workspace_id from profiles where id = auth.uid()
$$ language sql stable security definer;

create or replace function is_workspace_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  )
$$ language sql stable security definer;

-- =========================================================================
-- workspaces: members read their own; only admins update.
-- =========================================================================
create policy workspaces_member_read on workspaces for select
  using (id = current_workspace_id());

create policy workspaces_admin_update on workspaces for update
  using (id = current_workspace_id() and is_workspace_admin());

-- =========================================================================
-- profiles: a user reads their own profile.
-- =========================================================================
create policy profiles_self_read on profiles for select
  using (id = auth.uid());

-- =========================================================================
-- quizzes
-- =========================================================================
-- Public can read PUBLISHED quizzes only. This is what powers the
-- public quiz pages at /q/[slug] without authentication.
create policy quizzes_public_read_published on quizzes for select
  to anon, authenticated
  using (status = 'published');

-- Workspace members read all (including drafts) in their workspace.
create policy quizzes_member_read_all on quizzes for select
  to authenticated
  using (workspace_id = current_workspace_id());

-- Workspace admins write.
create policy quizzes_admin_write on quizzes for all
  to authenticated
  using (workspace_id = current_workspace_id() and is_workspace_admin())
  with check (workspace_id = current_workspace_id() and is_workspace_admin());

-- =========================================================================
-- questions & result_tiers: readable if the parent quiz is readable.
-- =========================================================================
create policy questions_inherit_quiz_read on questions for select
  to anon, authenticated
  using (
    exists (
      select 1 from quizzes q
      where q.id = questions.quiz_id
        and (
          q.status = 'published'
          or q.workspace_id = current_workspace_id()
        )
    )
  );

create policy questions_admin_write on questions for all
  to authenticated
  using (
    exists (
      select 1 from quizzes q
      where q.id = questions.quiz_id
        and q.workspace_id = current_workspace_id()
        and is_workspace_admin()
    )
  );

create policy result_tiers_inherit_quiz_read on result_tiers for select
  to anon, authenticated
  using (
    exists (
      select 1 from quizzes q
      where q.id = result_tiers.quiz_id
        and (
          q.status = 'published'
          or q.workspace_id = current_workspace_id()
        )
    )
  );

create policy result_tiers_admin_write on result_tiers for all
  to authenticated
  using (
    exists (
      select 1 from quizzes q
      where q.id = result_tiers.quiz_id
        and q.workspace_id = current_workspace_id()
        and is_workspace_admin()
    )
  );

-- =========================================================================
-- sessions / answers / leads:
-- Anon and authenticated users have NO direct write access via these
-- policies. All writes happen through Server Actions that use the
-- service-role key (which bypasses RLS). This is the §6 critical rule.
-- Workspace members can READ their own data.
-- =========================================================================
create policy sessions_member_read on sessions for select
  to authenticated
  using (
    exists (
      select 1 from quizzes q
      where q.id = sessions.quiz_id
        and q.workspace_id = current_workspace_id()
    )
  );

create policy answers_member_read on answers for select
  to authenticated
  using (
    exists (
      select 1 from sessions s
      join quizzes q on q.id = s.quiz_id
      where s.id = answers.session_id
        and q.workspace_id = current_workspace_id()
    )
  );

create policy leads_member_read on leads for select
  to authenticated
  using (workspace_id = current_workspace_id());

-- =========================================================================
-- destinations & destination_deliveries: admin-only.
-- =========================================================================
create policy destinations_admin_all on destinations for all
  to authenticated
  using (workspace_id = current_workspace_id() and is_workspace_admin())
  with check (workspace_id = current_workspace_id() and is_workspace_admin());

create policy destination_deliveries_admin_read on destination_deliveries for select
  to authenticated
  using (
    exists (
      select 1 from destinations d
      where d.id = destination_deliveries.destination_id
        and d.workspace_id = current_workspace_id()
        and is_workspace_admin()
    )
  );
