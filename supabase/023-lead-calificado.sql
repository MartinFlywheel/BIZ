-- Drop the old constraint
ALTER TABLE interactions DROP CONSTRAINT interactions_classification_check;

-- Add the new constraint with 'lead_calificado'
ALTER TABLE interactions ADD CONSTRAINT interactions_classification_check
  CHECK (classification IN ('chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified'));
