-- Link agenda_records back to the lead that booked it, so a call (and its
-- eventual show/close) can be attributed to the content piece that
-- originally drove that lead in (leads.first_touch_content_id). Needed to
-- filter the sales funnel by Reel vs Historia all the way through
-- Agendas/Shows/Cierres, not just Views/Chats/Conversaciones.
--
-- Note: existing rows will have lead_id = NULL — only bookings created after
-- this migration (and the matching webhook update) get attributed.

ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);
CREATE INDEX IF NOT EXISTS idx_agenda_records_lead ON agenda_records(lead_id);
