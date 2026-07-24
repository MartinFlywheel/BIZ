-- The day the lead's stage was changed to "Agendado" in the CRM — distinct
-- from fecha_agenda (the call date) and from created_at (row-insert
-- timestamp, not editable/meaningful to show as a date in the UI).
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS fecha_agendado DATE;

-- Backfill existing rows from their creation date so nothing shows blank.
UPDATE agenda_records SET fecha_agendado = created_at::date WHERE fecha_agendado IS NULL;
