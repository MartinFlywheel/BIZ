-- 057 — Exportar las personas con más de 1 CTA respondido
--
-- No es una migración: es una consulta de solo lectura para pegar en el editor
-- SQL de Supabase y bajar el resultado con "Download CSV". Se agrupa por
-- cliente + usuario de Instagram en minúsculas, igual que ctasDelLead en
-- src/lib/actions/leads.ts, y se cuentan los CTAs distintos (keyword_trigger
-- de la pieza de contenido). Se descartó contar interacciones crudas porque un
-- mismo CTA puede disparar el bot varias veces.

SELECT
  c.name                                                   AS cliente,
  COALESCE(l.full_name, MAX(i.prospect_name))              AS nombre,
  MAX(i.ig_username)                                       AS usuario_ig,
  l.email,
  l.phone                                                  AS telefono,
  l.stage                                                  AS etapa_pipeline,
  COUNT(DISTINCT cp.keyword_trigger)                       AS n_ctas_distintos,
  COUNT(i.id)                                              AS n_interacciones,
  STRING_AGG(DISTINCT cp.keyword_trigger, ' · ')           AS ctas,
  MAX(i.manychat_subscriber_id)                            AS manychat_subscriber_id,
  MIN(i.bot_triggered_at)                                  AS primera_interaccion,
  MAX(i.bot_triggered_at)                                  AS ultima_interaccion
FROM interactions i
JOIN clients c          ON c.id = i.client_id
LEFT JOIN content_pieces cp ON cp.id = i.content_id
LEFT JOIN leads l       ON l.client_id = i.client_id
                       AND LOWER(l.ig_username) = LOWER(i.ig_username)
WHERE i.ig_username IS NOT NULL
GROUP BY c.name, i.client_id, LOWER(i.ig_username), l.full_name, l.email, l.phone, l.stage
HAVING COUNT(DISTINCT cp.keyword_trigger) > 1
ORDER BY n_ctas_distintos DESC, n_interacciones DESC;
