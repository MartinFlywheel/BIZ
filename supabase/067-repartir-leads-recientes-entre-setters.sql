-- 067 · Repartir entre las setters los leads recientes que nadie trabajó
--
-- Mane sumó una segunda setter al equipo, pero los leads que ya estaban en la
-- base siguen apuntando a la setter que los recibió cuando era la única. La
-- asignación automática (pickBalancedSetter en src/lib/manychat.ts) solo actúa
-- sobre leads nuevos y nunca pisa un dueño existente, así que sin esta pasada
-- la setter nueva parte con la cuenta en cero y tarda semanas en emparejarse.
--
-- Qué leads se reparten: los que respondieron un CTA en las últimas 24 horas y
-- siguen en la etapa inicial del pipeline (o sin etapa). Que la etapa no haya
-- cambiado es la señal de que nadie los trabajó todavía; mover un lead con el
-- que ya hubo conversación sería quitárselo a quien lo venía siguiendo, y eso
-- esta migración no lo hace.
--
-- Cómo se reparten: se equilibra la carga total, con la misma regla que usa el
-- CRM en vivo — cada lead va a la setter con la menor razón (leads asignados ÷
-- lead_weight) en ese momento. Como la setter nueva parte de cero, se llevará
-- la mayor parte de este grupo; esa es justamente la intención, y el criterio
-- es el mismo que seguirá aplicando el webhook de ahí en adelante.
--
-- Se descartó partir el grupo en mitades iguales: emparejaría este lote pero
-- dejaría intacta la diferencia acumulada, que es el problema real.
--
-- Salvedad: en este grupo no se distingue una asignación hecha a mano de una
-- automática (no hay columna que lo marque). Si alguien asignó a dedo un lead
-- que sigue en la etapa inicial y respondió en las últimas 24 horas, también
-- entra en el reparto. Por eso se guarda el dueño anterior en
-- setter_antes_de_067, igual que la 063 hizo con stage_antes_de_063.
--
-- Idempotente: se puede correr dos veces. La segunda vez vuelve a mirar la
-- ventana de 24 horas y el reparto ya está equilibrado, así que cambia poco o
-- nada. setter_antes_de_067 solo se escribe la primera vez que se toca cada
-- lead, para que siga sirviendo para revertir.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS setter_antes_de_067 UUID REFERENCES users(id);

-- Antes: quién es cada setter de Mane y cuántos leads tiene hoy.
SELECT u.full_name AS setter, u.lead_weight AS peso, count(l.id) AS leads_asignados
FROM users u
JOIN clients c ON c.id = u.client_id
LEFT JOIN leads l ON l.assigned_to = u.id AND l.client_id = u.client_id
WHERE c.name ILIKE '%mane%'
  AND u.user_type = 'agency' AND u.is_active AND u.role = 'setter'
GROUP BY u.id, u.full_name, u.lead_weight
ORDER BY u.full_name;

DO $$
DECLARE
  v_cliente   UUID;
  v_coincide  INT;
  v_setters   INT;
  v_lead      RECORD;
  v_setter    UUID;
  v_movidos   INT := 0;
BEGIN
  SELECT count(*) INTO v_coincide FROM clients WHERE name ILIKE '%mane%';
  IF v_coincide <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente un cliente que coincida con "mane" y hay %. Revisa clients.name y ajusta el filtro antes de correr esto.', v_coincide;
  END IF;
  SELECT id INTO v_cliente FROM clients WHERE name ILIKE '%mane%';

  -- Por si el bloque se corre dos veces en la misma sesión: ON COMMIT DROP
  -- limpia al cerrar la transacción, no antes.
  DROP TABLE IF EXISTS pg_temp.candidatos;
  DROP TABLE IF EXISTS pg_temp.carga;

  -- Candidatos: etapa inicial (o sin etapa) y con una respuesta a un CTA en
  -- las últimas 24 horas. La interacción se cruza por interaction_id cuando
  -- existe y por usuario de Instagram en minúsculas cuando no — el webhook
  -- antiguo nunca escribió ese vínculo, así que hacen falta las dos vías.
  CREATE TEMP TABLE candidatos ON COMMIT DROP AS
  SELECT l.id, max(i.prospect_responded_at) AS ultima_respuesta
  FROM leads l
  JOIN clients c ON c.id = l.client_id
  JOIN interactions i
    ON i.client_id = l.client_id
   AND (i.id = l.interaction_id OR LOWER(i.ig_username) = LOWER(l.ig_username))
  WHERE l.client_id = v_cliente
    AND (
      l.stage IS NULL
      OR l.stage = ''
      OR l.stage = COALESCE(c.pipeline_stages->0->>'id', 'nuevo_contacto')
      OR l.stage IN ('nuevo_contacto', 'new')
    )
    AND i.classification IN ('conversacion_real', 'lead_calificado')
    AND i.prospect_responded_at >= now() - interval '24 hours'
  GROUP BY l.id;

  -- Carga actual de cada setter SIN contar los candidatos: se van a repartir
  -- de nuevo, así que contarlos donde están ahora sesgaría el resultado a
  -- favor de quien ya los tenía.
  CREATE TEMP TABLE carga ON COMMIT DROP AS
  SELECT u.id,
         u.lead_weight::numeric AS peso,
         (
           SELECT count(*)
           FROM leads l
           WHERE l.client_id = v_cliente
             AND l.assigned_to = u.id
             AND NOT EXISTS (SELECT 1 FROM candidatos k WHERE k.id = l.id)
         )::numeric AS n
  FROM users u
  WHERE u.client_id = v_cliente
    AND u.user_type = 'agency'
    AND u.is_active
    AND u.role = 'setter';

  SELECT count(*) INTO v_setters FROM carga;
  IF v_setters = 0 THEN
    RAISE EXCEPTION 'El cliente no tiene setters activos: no hay entre quiénes repartir.';
  END IF;

  -- Se recorre lead por lead, de la respuesta más reciente a la más antigua,
  -- porque la razón cambia con cada asignación: repartir en una sola sentencia
  -- le daría todo el lote a quien arrancó más abajo.
  FOR v_lead IN SELECT id FROM candidatos ORDER BY ultima_respuesta DESC, id LOOP
    SELECT id INTO v_setter FROM carga ORDER BY n / peso, random() LIMIT 1;

    UPDATE leads
       SET setter_antes_de_067 = COALESCE(setter_antes_de_067, assigned_to),
           assigned_to = v_setter,
           updated_at = now()
     WHERE id = v_lead.id
       AND assigned_to IS DISTINCT FROM v_setter;

    IF FOUND THEN
      v_movidos := v_movidos + 1;
    END IF;

    UPDATE carga SET n = n + 1 WHERE id = v_setter;
  END LOOP;

  RAISE NOTICE 'Candidatos: %. Reasignados: %. Setters activos: %.',
    (SELECT count(*) FROM candidatos), v_movidos, v_setters;
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

-- Para revertir este reparto (solo los leads que tocó):
-- UPDATE leads SET assigned_to = setter_antes_de_067, setter_antes_de_067 = NULL
-- WHERE setter_antes_de_067 IS NOT NULL;
