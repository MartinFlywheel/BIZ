-- =====================================================
-- Setter standards, activity logging, and daily reports
-- =====================================================
-- Backs the setter-app "Progreso" tab and the blocking daily report:
-- goals per setter/client, a granular log of every lead touch (so the
-- 100-leads-per-cycle and 50-followups-per-stage counters can't be gamed
-- by re-touching the same lead), and the submitted reports themselves.
--
-- Deliberately reuses the leads.stage values already in use everywhere
-- else (nuevo_contacto, micro_vsl_enviado, vsl_chat, calendly_enviado,
-- agendado, ...) — no new stage taxonomy, no CHECK constraint change on
-- leads. A parallel English stage set was considered and rejected: it
-- would have fragmented the pipeline into two systems that don't talk to
-- each other.
--
-- Safe to re-run: every statement is idempotent.

-- Every lead touch a setter makes, from updateLeadStageAction. Whether a
-- given touch is 'contacto' (the stage actually changed — progress) or
-- 'seguimiento' (re-marked the SAME stage it was already in — a follow-up
-- with no forward movement) is decided by the action itself, not by the
-- caller, so it can't be misreported from the client.
CREATE TABLE IF NOT EXISTS lead_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('contacto', 'seguimiento')),
  stage_at_time TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_activity_logs_user_created_idx ON lead_activity_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS lead_activity_logs_lead_id_idx ON lead_activity_logs(lead_id);

-- Minimums an admin sets per setter/client. Every column has a sane
-- default so the feature works immediately for a setter nobody has
-- configured yet, rather than crashing or silently showing 0/0.
CREATE TABLE IF NOT EXISTS setter_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  min_leads_touched INTEGER NOT NULL DEFAULT 100,
  min_followups_per_stage INTEGER NOT NULL DEFAULT 50,
  min_agendas_week INTEGER NOT NULL DEFAULT 5,
  min_agendas_month INTEGER NOT NULL DEFAULT 20,
  min_booking_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

-- The blocking report a setter submits on completing a cycle (crossing
-- min_leads_touched since their last submitted report — not a calendar
-- day; a slow day and a fast day both just end whenever the cycle
-- completes). cycle_started_at/cycle_ended_at bound the window the
-- auto-calculated counts below were computed over.
CREATE TABLE IF NOT EXISTS daily_setter_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cycle_started_at TIMESTAMPTZ NOT NULL,
  cycle_ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leads_touched INTEGER NOT NULL DEFAULT 0,
  agendas_set INTEGER NOT NULL DEFAULT 0,
  followups_total INTEGER NOT NULL DEFAULT 0,
  common_objections TEXT,
  marketing_feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_setter_reports_user_idx ON daily_setter_reports(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS daily_setter_reports_client_idx ON daily_setter_reports(client_id, submitted_at);

-- RLS — agency-only feature (setters + admins), no client-portal exposure,
-- same pattern as program_students/leads/agenda_records.
ALTER TABLE lead_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE setter_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_setter_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_full_access" ON lead_activity_logs;
CREATE POLICY "agency_full_access" ON lead_activity_logs FOR ALL USING (get_user_type() = 'agency');

DROP POLICY IF EXISTS "agency_full_access" ON setter_goals;
CREATE POLICY "agency_full_access" ON setter_goals FOR ALL USING (get_user_type() = 'agency');

DROP POLICY IF EXISTS "agency_full_access" ON daily_setter_reports;
CREATE POLICY "agency_full_access" ON daily_setter_reports FOR ALL USING (get_user_type() = 'agency');
