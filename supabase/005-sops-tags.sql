-- Add tags array to SOPs for multi-label filtering
-- Predefined tags: Ventas, Marketing, Setting, Closing, Historias
ALTER TABLE sops ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_sops_tags ON sops USING GIN(tags);
