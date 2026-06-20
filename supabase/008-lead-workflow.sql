-- =====================================================
-- Expand lead stages to match agency Airtable workflow
-- Add avatar classification + event tags
-- =====================================================

-- Drop old constraint and add expanded stages
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
  'nuevo_contacto',
  'seguimiento',
  'conversando',
  'agendado',
  'no_calificado',
  'vsl_enviado',
  'cliente',
  -- Legacy stages (backward compat)
  'new', 'contacted', 'agenda_set', 'showed_up', 'no_show', 'closed_won', 'closed_lost'
));

-- Avatar / lead classification
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_avatar TEXT;
-- Event tracking tags
ALTER TABLE leads ADD COLUMN IF NOT EXISTS events TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_leads_avatar ON leads(lead_avatar);
CREATE INDEX IF NOT EXISTS idx_leads_events ON leads USING GIN(events);
