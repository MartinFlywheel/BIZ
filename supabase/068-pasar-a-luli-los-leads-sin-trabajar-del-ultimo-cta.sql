-- 068 · Pasar a Luli los leads sin trabajar del último CTA
--
-- Magui está saturada: tiene más de 2.500 leads asignados contra los 12 de
-- Luli, y no alcanza a tomarlos. Se lanzó un CTA hace menos de 24 horas, y los
-- leads de ese CTA que Magui todavía no trabajó tienen que pasar a Luli.
--
-- Por qué no bastó la 067: exigía que la interacción fuera 'conversacion_real'
-- o 'lead_calificado'. En un CTA recién lanzado casi todo el lote está en
-- 'chat_abierto' — la persona disparó el bot y contestó el flujo, pero nadie
-- del equipo le escribió todavía, que es justamente el lote que hay que mover.
-- Acá se mira bot_triggered_at y no se filtra por clasificación.
--
-- Tampoco se equilibra la carga total como hacía la 067. Con la diferencia
-- acumulada que hay hoy, "equilibrar" y "pasarle todo el lote a Luli" dan casi
-- lo mismo, pero la intención es distinta y conviene que el SQL diga la real:
-- descargar a Magui de lo que no alcanza a atender.
--
-- Sigue valiendo la regla de la 067 para no pisar trabajo ajeno: solo se mueven
-- los leads que siguen en la etapa inicial del pipeline (o sin etapa). Si la
-- etapa ya cambió, alguien lo está trabajando y no se toca.
--
-- Idempotente: se puede correr dos veces; la segunda no encuentra nada que
-- mover porque esos leads ya son de Luli. El dueño anterior queda en
-- setter_antes_de_068 para poder revertir.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS setter_antes_de_068 UUID REFERENCES users(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 · Diagnóstico. Corre esto primero y mira qué hay antes de mover nada.
-- Una fila por CTA de las últimas 24 horas: cuánta gente entró, en qué estado
-- está y cuántos siguen sin trabajar.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COALESCE(cp.keyword_trigger, i.keyword_used, '(sin CTA identificado)') AS cta,
  i.classification,
  count(DISTINCT l.id)                                                   AS leads,
  count(DISTINCT l.id) FILTER (
    WHERE l.stage IS NULL OR l.stage = '' OR l.stage IN ('nuevo_contacto', 'new')
  )                                                                      AS sin_trabajar,
  count(DISTINCT l.id) FILTER (WHERE u.full_name ILIKE '%magui%')        AS de_magui,
  count(DISTINCT l.id) FILTER (WHERE u.full_name ILIKE '%luli%')         AS de_luli,
  count(DISTINCT l.id) FILTER (WHERE l.assigned_to IS NULL)              AS sin_asignar,
  min(i.bot_triggered_at)                                                AS primer_disparo,
  max(i.bot_triggered_at)                                                AS ultimo_disparo
FROM interactions i
JOIN clients c              ON c.id = i.client_id
LEFT JOIN content_pieces cp ON cp.id = i.content_id
LEFT JOIN leads l           ON l.client_id = i.client_id
                           AND (l.interaction_id = i.id OR LOWER(l.ig_username) = LOWER(i.ig_username))
LEFT JOIN users u           ON u.id = l.assigned_to
WHERE c.name ILIKE '%mane%'
  AND i.bot_triggered_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY leads DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 · El traspaso.
-- Antes de correrlo, ajusta las variables de abajo si hace falta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Repetido a propósito: así esta parte se puede correr sola, sin la de arriba.
-- Si la columna ya existe, no hace nada.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS setter_antes_de_068 UUID REFERENCES users(id);

DO $$
DECLARE
  -- CTA a mover, por keyword_trigger de la pieza (o keyword_used de la
  -- interacción). NULL = todos los CTA de la ventana, que es lo que sirve si
  -- en las últimas 24 horas se lanzó uno solo.
  v_cta      TEXT := NULL;
  -- Ventana hacia atrás desde ahora.
  v_horas    INT  := 24;
  -- Quién recibe.
  v_destino  TEXT := '%luli%';
  -- Tope opcional de leads a traspasar. NULL = todos los que califiquen.
  v_maximo   INT  := NULL;

  v_cliente  UUID;
  v_luli     UUID;
  v_movidos  INT;
BEGIN
  SELECT id INTO v_cliente FROM clients WHERE name ILIKE '%mane%';
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'No se encontró el cliente. Revisa clients.name y ajusta el filtro.';
  END IF;

  SELECT id INTO v_luli
  FROM users
  WHERE client_id = v_cliente AND user_type = 'agency' AND is_active
    AND role = 'setter' AND full_name ILIKE v_destino;
  IF v_luli IS NULL THEN
    RAISE EXCEPTION 'No hay una setter activa que coincida con % en este cliente.', v_destino;
  END IF;

  WITH candidatos AS (
    SELECT l.id
    FROM leads l
    JOIN clients c ON c.id = l.client_id
    JOIN interactions i
      ON i.client_id = l.client_id
     AND (i.id = l.interaction_id OR LOWER(i.ig_username) = LOWER(l.ig_username))
    LEFT JOIN content_pieces cp ON cp.id = i.content_id
    WHERE l.client_id = v_cliente
      -- Nadie lo trabajó todavía: sigue en la etapa inicial del tablero.
      AND (
        l.stage IS NULL
        OR l.stage = ''
        OR l.stage = COALESCE(c.pipeline_stages->0->>'id', 'nuevo_contacto')
        OR l.stage IN ('nuevo_contacto', 'new')
      )
      -- Ya es de Luli: no hay nada que mover.
      AND l.assigned_to IS DISTINCT FROM v_luli
      -- Tocó el CTA dentro de la ventana. Sin filtro de clasificación: el lote
      -- recién entrado está en 'chat_abierto' y es el que hay que repartir.
      AND i.bot_triggered_at >= now() - make_interval(hours => v_horas)
      AND (
        v_cta IS NULL
        OR cp.keyword_trigger ILIKE v_cta
        OR i.keyword_used ILIKE v_cta
      )
    GROUP BY l.id
    ORDER BY max(i.bot_triggered_at) DESC
    LIMIT v_maximo  -- NULL = sin tope
  )
  UPDATE leads l
     SET setter_antes_de_068 = COALESCE(l.setter_antes_de_068, l.assigned_to),
         assigned_to = v_luli,
         updated_at = now()
    FROM candidatos k
   WHERE l.id = k.id;

  GET DIAGNOSTICS v_movidos = ROW_COUNT;
  RAISE NOTICE 'Leads traspasados a Luli: %.', v_movidos;
END;
$$;

-- Después: cómo quedó el reparto.
SELECT u.full_name AS setter, u.lead_weight AS peso, count(l.id) AS leads_asignados
FROM users u
JOIN clients c ON c.id = u.client_id
LEFT JOIN leads l ON l.assigned_to = u.id AND l.client_id = u.client_id
WHERE c.name ILIKE '%mane%'
  AND u.user_type = 'agency' AND u.is_active AND u.role = 'setter'
GROUP BY u.id, u.full_name, u.lead_weight
ORDER BY u.full_name;

-- Para revertir solo este traspaso:
-- UPDATE leads SET assigned_to = setter_antes_de_068, setter_antes_de_068 = NULL
-- WHERE setter_antes_de_068 IS NOT NULL;
