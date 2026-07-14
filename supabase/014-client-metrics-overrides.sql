-- Repurpose client_metrics numeric columns as manual overrides for the
-- otherwise-live-computed "Contenido" register (views/chats/conversaciones/
-- agendas/shows/cierres/facturación/cash). NULL means "no override, use the
-- live-computed value"; a non-null number wins over the computed value for
-- that period.

ALTER TABLE client_metrics ALTER COLUMN views_reels DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN views_historias DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN chats_abiertos DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN conversaciones DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN agendas DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN shows DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN cierres DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN facturacion DROP DEFAULT;
ALTER TABLE client_metrics ALTER COLUMN cash_collected DROP DEFAULT;

-- Clear legacy manually-entered values so old rows aren't misread as
-- overrides for periods nobody has actually corrected since the switch to
-- live-computed metrics.
UPDATE client_metrics SET
  views_reels = NULL,
  views_historias = NULL,
  chats_abiertos = NULL,
  conversaciones = NULL,
  agendas = NULL,
  shows = NULL,
  cierres = NULL,
  facturacion = NULL,
  cash_collected = NULL;
