-- =====================================================
-- CONTENT METRICS — Per-piece attribution funnel
-- Each Reel/Story has its own complete funnel:
-- Views → Chats → Conversaciones → Agendas → Shows → Cierres
-- =====================================================

CREATE TABLE content_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content_pieces(id) NOT NULL,
  client_id UUID REFERENCES clients(id) NOT NULL,

  -- Top of Funnel
  views INTEGER DEFAULT 0,

  -- Middle of Funnel
  chats_nuevos INTEGER DEFAULT 0,
  conversaciones_nuevas INTEGER DEFAULT 0,
  agendas INTEGER DEFAULT 0,

  -- Bottom of Funnel
  shows INTEGER DEFAULT 0,
  cierres INTEGER DEFAULT 0,

  -- Financials
  ticket DECIMAL(12,2) DEFAULT 0,
  aov DECIMAL(12,2) DEFAULT 0,
  cash_collected DECIMAL(12,2) DEFAULT 0,

  -- Manychat label for traceability (e.g. 'REEL - EQUIPO - 14/01/2026')
  manychat_label TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(content_id)
);

CREATE INDEX idx_content_metrics_client ON content_metrics(client_id);
CREATE INDEX idx_content_metrics_content ON content_metrics(content_id);

ALTER TABLE content_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON content_metrics
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency')
  );

CREATE POLICY "client_own_metrics" ON content_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'client' AND client_id = content_metrics.client_id)
  );
