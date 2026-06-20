-- =====================================================
-- Link leads directly to content pieces (manual assignment)
-- Expand stages to match setter workflow exactly
-- =====================================================

-- Direct content attribution (setter assigns manually)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS content_id UUID REFERENCES content_pieces(id);
CREATE INDEX IF NOT EXISTS idx_leads_content ON leads(content_id);

-- Expand stages to full setter workflow
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
  -- Active setter workflow
  'nuevo_contacto',
  'seguimiento',
  'conversando',
  'micro_vsl_enviado',
  'vsl_chat',
  'pitcheado',
  'calendly_enviado',
  'seguimiento_1',
  'seguimiento_2',
  'propuesta_enviada',
  'agendado',
  'no_calificado',
  'cierre',
  -- Legacy (backward compat)
  'new', 'contacted', 'agenda_set', 'showed_up', 'no_show',
  'closed_won', 'closed_lost', 'vsl_enviado', 'cliente'
));
