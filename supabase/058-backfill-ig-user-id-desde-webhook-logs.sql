-- 058 — Rellenar interactions.ig_user_id desde los payloads de ManyChat
--
-- ManyChat manda en cada webhook de "Full Contact Data" el campo ig_id (el ID
-- de Instagram del suscriptor). Los dos webhooks (src/lib/manychat.ts y
-- src/app/api/webhooks/manychat/route.ts) lo descartaban y la columna
-- interactions.ig_user_id quedó vacía en todas las filas. Desde este cambio el
-- código lo guarda; esta migración recupera el histórico desde webhook_logs,
-- donde sí quedó el payload crudo. Se enlaza primero por subscriber_id (exacto)
-- y luego por usuario de Instagram en minúsculas. Idempotente: solo toca filas
-- con ig_user_id nulo.

CREATE INDEX IF NOT EXISTS idx_webhook_logs_payload_ig_id
  ON webhook_logs ((payload->>'ig_id'));

WITH ids AS (
  SELECT DISTINCT ON (sub)
    COALESCE(payload->>'subscriber_id', payload->>'id') AS sub,
    payload->>'ig_id' AS ig_id
  FROM webhook_logs
  WHERE payload->>'ig_id' IS NOT NULL AND payload->>'ig_id' <> ''
    AND COALESCE(payload->>'subscriber_id', payload->>'id') IS NOT NULL
  ORDER BY sub, received_at DESC
)
UPDATE interactions i
SET ig_user_id = ids.ig_id
FROM ids
WHERE i.ig_user_id IS NULL
  AND i.manychat_subscriber_id = ids.sub;

WITH ids AS (
  SELECT DISTINCT ON (u)
    LOWER(TRIM(LEADING '@' FROM COALESCE(payload->>'ig_username', payload->>'instagram_user_handle', payload->>'username', payload->>'instagram_username'))) AS u,
    payload->>'ig_id' AS ig_id
  FROM webhook_logs
  WHERE payload->>'ig_id' IS NOT NULL AND payload->>'ig_id' <> ''
    AND COALESCE(payload->>'ig_username', payload->>'instagram_user_handle', payload->>'username', payload->>'instagram_username') IS NOT NULL
  ORDER BY u, received_at DESC
)
UPDATE interactions i
SET ig_user_id = ids.ig_id
FROM ids
WHERE i.ig_user_id IS NULL
  AND LOWER(i.ig_username) = ids.u;
