-- =====================================================
-- 043 — Índices para la paginación por cursor
-- =====================================================
-- Síntoma: la pestaña CRM de un cliente devolvía un 500 y el navegador mostraba
-- "This page couldn't load". En los logs de Vercel:
--
--   POST /clients/ad9b2e47-…
--   Error: {"code":"57014","message":"canceling statement due to statement timeout"}
--   digest: '2562502645@E394'
--
-- 57014 es el statement_timeout de Postgres. Supabase lo tiene en 8 s para el
-- rol `authenticated`, así que la Server Action que carga la pestaña se pasaba
-- de ese presupuesto y el motor mataba la consulta.
--
-- CAUSA
-- getLeads y getInteractions pasaron a paginación por cursor (keyset) para
-- dejar de usar OFFSET, que ya había dado timeouts. La consulta que emiten es:
--
--   WHERE client_id = $1 AND id > $cursor ORDER BY id LIMIT n
--
-- Pero los índices que existían son (client_id, stage) en leads y
-- (client_id, bot_triggered_at) en interactions: **ninguno lleva `id` como
-- segunda columna**. Sin eso Postgres no puede recorrer un rango ordenado, así
-- que filtra por cliente y ORDENA todo el conjunto para poder aplicar
-- `id > cursor` y el LIMIT. Y como la paginación repite la consulta una vez por
-- página, ese orden se paga entero en cada vuelta. Con miles de filas por
-- cliente, la suma se come los 8 s.
--
-- La paginación por cursor era la optimización correcta; lo que faltaba era el
-- índice que la sostiene.
--
-- CON ESTO
-- Cada página pasa a ser un salto directo a (client_id, cursor) y una lectura
-- hacia adelante de `limit` filas: sin ordenamiento y sin recorrer lo que ya
-- quedó atrás.

-- leads → getLeads (pestaña CRM) y el cron prune-stale-leads
CREATE INDEX IF NOT EXISTS idx_leads_client_id_keyset ON leads(client_id, id);

-- interactions → getInteractions (misma pestaña) y el mismo cron
CREATE INDEX IF NOT EXISTS idx_interactions_client_id_keyset ON interactions(client_id, id);

-- Los índices viejos NO se borran: (client_id, stage) y
-- (client_id, bot_triggered_at) siguen sirviendo a los filtros por etapa y a
-- las consultas por rango de fechas de las métricas. Estos dos se suman para el
-- caso de recorrer todo el cliente en orden de id.

ANALYZE leads;
ANALYZE interactions;
