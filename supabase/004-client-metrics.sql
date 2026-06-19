-- =====================================================
-- CLIENT METRICS — Weekly/daily performance snapshots
-- One row per client per period. The funnel server action
-- reads from here; the dashboard and health alerts query it.
-- =====================================================

CREATE TABLE client_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type TEXT CHECK (period_type IN ('daily', 'weekly', 'monthly')) DEFAULT 'weekly',

  -- Raw volume numbers
  views_reels INTEGER DEFAULT 0,
  views_historias INTEGER DEFAULT 0,
  chats_abiertos INTEGER DEFAULT 0,
  conversaciones INTEGER DEFAULT 0,
  agendas INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  cierres INTEGER DEFAULT 0,
  facturacion DECIMAL(12,2) DEFAULT 0,
  cash_collected DECIMAL(12,2) DEFAULT 0,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(client_id, period_start, period_type)
);

CREATE INDEX idx_client_metrics_client ON client_metrics(client_id, period_start DESC);
CREATE INDEX idx_client_metrics_period ON client_metrics(period_type, period_start DESC);

-- RLS
ALTER TABLE client_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON client_metrics
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency')
  );

CREATE POLICY "client_own_metrics" ON client_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'client' AND client_id = client_metrics.client_id)
  );
