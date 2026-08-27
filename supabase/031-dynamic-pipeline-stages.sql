-- =====================================================
-- Drop fixed pipeline stages to allow dynamic ones
-- =====================================================

-- Drop the hardcoded constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;

-- Add pipeline_stages JSONB to clients to store custom configurations
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pipeline_stages JSONB DEFAULT NULL;
