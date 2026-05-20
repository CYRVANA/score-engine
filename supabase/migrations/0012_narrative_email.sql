-- score-engine — extend ai_narratives with email delivery tracking.
-- Phase 3b. The narrative worker (generate-narrative Edge Function) takes
-- on a second responsibility: after writing a generated narrative, it sends
-- a result email to the prospect via Resend. Status is tracked per row so
-- failed sends can be retried and observed from the admin UI.

alter table ai_narratives
  add column if not exists email_status     text not null default 'pending',
  add column if not exists email_sent_at    timestamptz,
  add column if not exists email_attempts   int not null default 0,
  add column if not exists email_last_error text,
  add column if not exists email_message_id text;

alter table ai_narratives
  drop constraint if exists ai_narratives_email_status_check;

alter table ai_narratives
  add constraint ai_narratives_email_status_check
  check (email_status in ('pending', 'sent', 'failed', 'skipped'));

-- Worker queries for "narratives delivered but email still pending."
create index if not exists ai_narratives_email_pending_idx
  on ai_narratives (status, email_status)
  where status = 'delivered' and email_status = 'pending';

comment on column ai_narratives.email_status is
  'Email delivery state: pending (worker will send), sent (Resend accepted it), failed (gave up after retries), skipped (FEATURE_EMAIL_NARRATIVES off at send time).';
comment on column ai_narratives.email_message_id is
  'Resend message id, returned when an email is accepted by the provider.';
