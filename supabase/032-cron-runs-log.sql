-- =====================================================
-- CRON RUNS LOG — lightweight, queryable audit trail for cron jobs
-- Vercel's runtime logs only retain a few hours on this project, so a
-- job's own JSON response (e.g. "deleted: 5") is unrecoverable once that
-- window passes. This table persists a one-row summary per run so it can
-- be checked anytime, not just right after it fires.
-- =====================================================

CREATE TABLE cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cron_runs_job_name ON cron_runs(job_name, ran_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON cron_runs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency')
  );
