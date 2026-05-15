-- score-engine — seed data
-- Creates the CYRVANA workspace and a demo "Cyber Readiness" quiz so the
-- Phase 1 public quiz page has something to render against.

insert into workspaces (id, slug, name, plan) values
  ('00000000-0000-0000-0000-000000000001', 'cyrvana', 'CYRVANA', 'self');

insert into quizzes (id, workspace_id, slug, title, description, status, published_at) values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'cyber-readiness',
    'Cyber Readiness Assessment',
    'A quick 5-question assessment to gauge your organization''s cybersecurity readiness.',
    'published',
    now()
  );

-- Questions
insert into questions (quiz_id, order_index, type, prompt, options, weight) values
  (
    '10000000-0000-0000-0000-000000000001', 1, 'single_choice',
    'How often do you review your access controls?',
    '[
      {"label": "Quarterly or more frequently", "points": 4},
      {"label": "Once or twice a year", "points": 2},
      {"label": "Rarely or never", "points": 0}
    ]'::jsonb,
    1
  ),
  (
    '10000000-0000-0000-0000-000000000001', 2, 'single_choice',
    'Do you have an incident response plan?',
    '[
      {"label": "Yes, tested in the last 6 months", "points": 4},
      {"label": "Yes, but not tested recently", "points": 2},
      {"label": "No, or unsure", "points": 0}
    ]'::jsonb,
    1
  ),
  (
    '10000000-0000-0000-0000-000000000001', 3, 'single_choice',
    'How is multi-factor authentication deployed?',
    '[
      {"label": "Required for all employees and contractors", "points": 4},
      {"label": "Required for some roles or systems", "points": 2},
      {"label": "Not deployed or optional", "points": 0}
    ]'::jsonb,
    1
  ),
  (
    '10000000-0000-0000-0000-000000000001', 4, 'single_choice',
    'How do you manage third-party vendor risk?',
    '[
      {"label": "Formal program with continuous monitoring", "points": 4},
      {"label": "Ad-hoc assessments at onboarding", "points": 2},
      {"label": "No formal process", "points": 0}
    ]'::jsonb,
    1
  ),
  (
    '10000000-0000-0000-0000-000000000001', 5, 'single_choice',
    'When was your last penetration test?',
    '[
      {"label": "Within the last 12 months", "points": 4},
      {"label": "More than a year ago", "points": 2},
      {"label": "Never or unsure", "points": 0}
    ]'::jsonb,
    1
  );

-- Result tiers (max score is 20: 5 questions × 4 max points)
insert into result_tiers (quiz_id, min_score, max_score, title, description, cta_label, cta_url) values
  (
    '10000000-0000-0000-0000-000000000001', 0, 7,
    'Foundational',
    'Your organization has significant gaps in cyber readiness. Building a baseline program — access reviews, MFA, an incident response plan — should be the immediate priority. CYRVANA''s vCISO advisory can help you build a roadmap.',
    'Talk to a vCISO',
    'https://cyrvana.com/services/vciso'
  ),
  (
    '10000000-0000-0000-0000-000000000001', 8, 14,
    'Developing',
    'You have key controls in place but maturity is uneven. The next move is closing gaps in vendor risk and incident response testing. A targeted assessment will identify the highest-leverage improvements.',
    'Schedule an assessment',
    'https://cyrvana.com/services/risk-compliance'
  ),
  (
    '10000000-0000-0000-0000-000000000001', 15, 20,
    'Mature',
    'You operate a well-rounded cyber program. Focus areas now are continuous improvement: red-team exercises, third-party assurance, and aligning with frameworks like CMMC or ISO 27001 if relevant to your business.',
    'Explore advanced services',
    'https://cyrvana.com/services'
  );
