-- The reel's call-to-action goal (Sígueme, Comenta, etc.) — separate from
-- "Ángulo" (the content angle/theme), so both can be tracked and shown on
-- the pipeline card independently.
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS objective TEXT;
