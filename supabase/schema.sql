-- =====================================================
-- BIZ CRM — Schema v2
-- =====================================================

-- USUARIOS (AGENCY + CLIENT PORTAL)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  user_type TEXT CHECK (user_type IN ('agency', 'client')) NOT NULL DEFAULT 'agency',
  role TEXT CHECK (role IN (
    'admin', 'sales_director', 'closer', 'setter', 'editor', 'client_owner'
  )) NOT NULL,
  client_id UUID,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CLIENTES DE LA AGENCIA
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ig_handle TEXT NOT NULL,
  ig_account_id TEXT,
  industry TEXT,
  status TEXT CHECK (status IN ('prospect', 'onboarding', 'active', 'paused', 'churned')) DEFAULT 'prospect',
  monthly_fee DECIMAL(12,2),
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ADD CONSTRAINT fk_users_client
  FOREIGN KEY (client_id) REFERENCES clients(id);

-- ORGANIGRAMA HÍBRIDO POR CLIENTE
CREATE TABLE team_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  responsibility TEXT CHECK (responsibility IN ('content', 'setting', 'closing', 'strategy')) NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, user_id, responsibility)
);

-- CAMPAÑAS
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  goal TEXT,
  status TEXT CHECK (status IN ('draft', 'active', 'completed')) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CONTENIDO (REELS / STORIES)
CREATE TABLE content_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  campaign_id UUID REFERENCES campaigns(id),
  content_type TEXT CHECK (content_type IN ('reel', 'story', 'post', 'live')) NOT NULL,
  ig_media_id TEXT,
  ig_permalink TEXT,
  ig_thumbnail_url TEXT,
  caption TEXT,
  keyword_trigger TEXT,
  published_at TIMESTAMPTZ,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  metrics_source TEXT CHECK (metrics_source IN ('manual', 'meta_api')) DEFAULT 'manual',
  metrics_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- MÉTRICAS DE FUNNEL POR PIEZA DE CONTENIDO (Atribución por Contenido)
CREATE TABLE content_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content_pieces(id) ON DELETE CASCADE NOT NULL UNIQUE,
  client_id UUID REFERENCES clients(id) NOT NULL,
  -- Funnel de conversión atribuido a esta pieza
  chats_nuevos INTEGER DEFAULT 0,
  conversaciones INTEGER DEFAULT 0,
  agendas INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  cierres INTEGER DEFAULT 0,
  -- Métricas económicas
  ticket DECIMAL(12,2),
  aov DECIMAL(12,2),
  cash_collected DECIMAL(12,2),
  -- Etiqueta de ManyChat para tracking
  manychat_label TEXT,
  -- Notas cualitativas del equipo
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_metrics_client ON content_metrics(client_id);
CREATE INDEX idx_content_metrics_content ON content_metrics(content_id);

-- NOTAS CUALITATIVAS DE CONTENIDO
CREATE TABLE content_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES content_pieces(id) NOT NULL,
  author_id UUID REFERENCES users(id) NOT NULL,
  note TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_notes_tags ON content_notes USING GIN(tags);

-- INTERACCIONES — MOTOR ANTI FALSOS POSITIVOS
CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  content_id UUID REFERENCES content_pieces(id),
  campaign_id UUID REFERENCES campaigns(id),
  ig_user_id TEXT,
  ig_username TEXT,
  prospect_name TEXT,
  classification TEXT CHECK (classification IN ('chat_abierto', 'conversacion_real', 'disqualified')) DEFAULT 'chat_abierto',
  source TEXT CHECK (source IN ('manychat', 'gohighlevel', 'manual', 'api')) DEFAULT 'manual',
  manychat_subscriber_id TEXT,
  keyword_used TEXT,
  bot_triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prospect_responded_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  prequalification_data JSONB DEFAULT '{}',
  promoted_to_lead BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_interactions_client_date ON interactions(client_id, bot_triggered_at);
CREATE INDEX idx_interactions_classification ON interactions(classification);
CREATE INDEX idx_interactions_campaign ON interactions(campaign_id);

-- LEADS + ATRIBUCIÓN MULTI-TOUCH
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  interaction_id UUID REFERENCES interactions(id),
  ig_username TEXT,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  stage TEXT CHECK (stage IN ('new', 'contacted', 'agenda_set', 'showed_up', 'no_show', 'closed_won', 'closed_lost')) DEFAULT 'new',
  assigned_to UUID REFERENCES users(id),
  notes TEXT,
  lost_reason TEXT,
  first_touch_content_id UUID REFERENCES content_pieces(id),
  first_touch_at TIMESTAMPTZ,
  first_touch_type TEXT,
  conversion_touch_content_id UUID REFERENCES content_pieces(id),
  conversion_touch_at TIMESTAMPTZ,
  conversion_touch_type TEXT,
  contacted_at TIMESTAMPTZ,
  agenda_at TIMESTAMPTZ,
  call_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_value DECIMAL(12,2),
  days_to_close DECIMAL(8,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_client_stage ON leads(client_id, stage);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_first_touch ON leads(first_touch_content_id);
CREATE INDEX idx_leads_conversion_touch ON leads(conversion_touch_content_id);

CREATE OR REPLACE FUNCTION calculate_days_to_close()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IN ('closed_won', 'closed_lost') AND NEW.first_touch_at IS NOT NULL THEN
    NEW.days_to_close := EXTRACT(EPOCH FROM (COALESCE(NEW.closed_at, now()) - NEW.first_touch_at)) / 86400.0;
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calculate_days_to_close
  BEFORE UPDATE ON leads
  FOR EACH ROW
  WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
  EXECUTE FUNCTION calculate_days_to_close();

-- LLAMADAS DE VENTAS
CREATE TABLE sales_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) NOT NULL,
  caller_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  outcome TEXT CHECK (outcome IN ('completed', 'no_show', 'rescheduled', 'cancelled')),
  fathom_recording_id TEXT,
  fathom_call_url TEXT,
  transcript TEXT,
  ai_summary TEXT,
  objections JSONB DEFAULT '[]',
  next_steps TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- BENCHMARKS + DIAGNÓSTICO
CREATE TABLE benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  metric_key TEXT NOT NULL,
  threshold_value DECIMAL(5,2) NOT NULL,
  comparison TEXT CHECK (comparison IN ('gte', 'lte')) DEFAULT 'gte',
  responsible_area TEXT CHECK (responsible_area IN ('content', 'setting', 'closing', 'strategy')),
  diagnosis_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, metric_key)
);

INSERT INTO benchmarks (client_id, metric_key, threshold_value, comparison, responsible_area, diagnosis_message) VALUES
  (NULL, 'tasa_respuesta', 25.00, 'gte', 'content',  'Falla en Tasa de Respuesta: el contenido no genera suficiente interés o el CTA no conecta.'),
  (NULL, 'tasa_show_up',   60.00, 'gte', 'setting',  'Falla en Tasa de Show-up: revisar proceso de confirmación y seguimiento pre-llamada.'),
  (NULL, 'tasa_cierre',    20.00, 'gte', 'closing',  'Falla en Tasa de Cierre: revisar script de ventas, manejo de objeciones y oferta.');

-- NOTIFICACIONES IN-APP
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT CHECK (type IN ('alert', 'diagnosis', 'assignment', 'system')) DEFAULT 'system',
  severity TEXT CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
  reference_type TEXT,
  reference_id UUID,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- HUB DE INTEGRACIONES
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  platform TEXT CHECK (platform IN ('instagram', 'manychat', 'gohighlevel', 'funnelapp', 'fathom')) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  status TEXT CHECK (status IN ('connected', 'disconnected', 'error', 'pending_review')) DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, platform)
);

CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES integrations(id) NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT CHECK (status IN ('started', 'completed', 'failed')) NOT NULL,
  records_processed INTEGER DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- SOPs Y ONBOARDING
CREATE TABLE sops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE onboarding_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE onboarding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES onboarding_templates(id) NOT NULL,
  client_id UUID REFERENCES clients(id) NOT NULL,
  status TEXT CHECK (status IN ('in_progress', 'completed', 'cancelled')) DEFAULT 'in_progress',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE onboarding_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES onboarding_runs(id) NOT NULL,
  step_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  sop_id UUID REFERENCES sops(id),
  assigned_to UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  completed_at TIMESTAMPTZ
);

-- WEBHOOK LOG
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  error TEXT,
  received_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_user_type()
RETURNS TEXT AS $$
  SELECT user_type FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Clients
CREATE POLICY "agency_full_access" ON clients FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON clients FOR SELECT USING (get_user_type() = 'client' AND id = get_user_client_id());

-- Campaigns
CREATE POLICY "agency_full_access" ON campaigns FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON campaigns FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Content pieces
CREATE POLICY "agency_full_access" ON content_pieces FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON content_pieces FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Content notes
CREATE POLICY "agency_full_access" ON content_notes FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON content_notes FOR SELECT USING (
  get_user_type() = 'client' AND content_id IN (SELECT id FROM content_pieces WHERE client_id = get_user_client_id())
);

-- Interactions
CREATE POLICY "agency_full_access" ON interactions FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON interactions FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Leads
CREATE POLICY "agency_full_access" ON leads FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON leads FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Sales calls
CREATE POLICY "agency_full_access" ON sales_calls FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON sales_calls FOR SELECT USING (
  get_user_type() = 'client' AND lead_id IN (SELECT id FROM leads WHERE client_id = get_user_client_id())
);

-- Team assignments
CREATE POLICY "agency_full_access" ON team_assignments FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON team_assignments FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Content metrics
ALTER TABLE content_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_full_access" ON content_metrics FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON content_metrics FOR SELECT USING (get_user_type() = 'client' AND client_id = get_user_client_id());

-- Notifications
CREATE POLICY "own_notifications" ON notifications FOR ALL USING (user_id = auth.uid());
