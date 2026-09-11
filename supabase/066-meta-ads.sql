/*
  066 · Anuncios de Meta por cliente

  Problema: la pestaña Anuncios lee las campañas de Meta en vivo y no guarda
  nada. Para atribuir personas a anuncios hace falta saber a qué campaña
  pertenece cada anuncio y cómo se llama, y Meta borra o renombra anuncios:
  si solo se consultara en vivo, las personas de anuncios viejos quedarían
  huérfanas.

  Solución: una tabla con los anuncios vistos por cliente. Cada vez que se
  abre la pestaña Anuncios se actualizan nombres y campaña; el gasto no se
  guarda porque cambia a diario y se sigue leyendo en vivo.

  El id del anuncio es el mismo que WhatsApp entrega en el referral
  (source_id) cuando alguien escribe desde un anuncio "click to WhatsApp",
  y que el agente manda al CRM (leads.referral, migración 065).
*/

CREATE TABLE IF NOT EXISTS meta_ads (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  status TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_name TEXT,
  visto_por_primera_vez TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, ad_id)
);

ALTER TABLE meta_ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_full_access" ON meta_ads;
CREATE POLICY "agency_full_access" ON meta_ads FOR ALL USING (get_user_type() = 'agency');
