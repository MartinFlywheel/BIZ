-- =====================================================
-- 081 — Un lead por Instagram: fusionar los repetidos y un índice único
-- =====================================================
--
-- EL PROBLEMA
-- La 079 fusionó solo los duplicados que dejaba "Crear y asociar" del
-- triaje. Quedaban 27 usuarios de Instagram con dos o tres leads en el mismo
-- cliente (57 leads, todos de Mane), por tres vías:
--   - ManyChat crea el lead sin setter y horas después una setter lo crea a
--     mano con "Nuevo Lead" (la mayoría). createLeadAction no revisaba si el
--     @ ya existía, y una setter no ve los leads calificados de otra, así que
--     tampoco podía saberlo.
--   - Dos setters crean a mano la misma persona (gisellanino,
--     haydeesaavedramerino).
--   - Dos llamadas de ManyChat casi juntas: teru_tessa quedó tres veces en el
--     mismo minuto.
-- Con dos leads, la conversación queda en uno y la agenda o la etapa en otro,
-- a veces con setters distintas, y las métricas cuentan dos personas.
--
-- El código ya se corrigió: toda vía que crea leads busca antes por
-- Instagram (src/lib/lead-por-instagram.ts) y, si choca con el índice de esta
-- migración, usa el lead que ya existe. Funciona con o sin esta migración.
--
-- QUÉ SE DECIDIÓ
-- ig_normalizado(texto): minúsculas, sin espacios y sin "@". Es la misma
-- normalización del código. Con ella se agrupan los repetidos y se arma el
-- índice.
--
-- Por cada grupo:
--   - Queda el lead MÁS ANTIGUO: conserva la fecha de ingreso y la
--     atribución de ManyChat (interaction_id, pieza, primer contacto).
--   - Etapa, seguimiento y fecha de agenda salen del lead MÁS AVANZADO en el
--     pipeline del cliente (empate: el de más actividad registrada y después
--     el editado más recientemente). Así una conversación que la setter llevó
--     a "agendado" no vuelve a "nuevo contacto".
--   - La setter es la de ese mismo lead; si no tiene, la del lead con más
--     actividad que sí tenga.
--   - El resto de las columnas vacías se completa con las de los otros leads,
--     del más antiguo al más nuevo. Las notas se juntan y las etiquetas
--     (events) se unen.
--   - Todo lo que apunta a los otros leads (agendas, actividad, mensajes,
--     llamadas, historial) pasa al que queda, y los otros se borran.
-- Después se quita el "@" de los pocos usuarios guardados con él y se crea
-- el índice único uq_leads_client_ig.
--
-- Se descartó:
--   - Quedarse con el lead más trabajado en vez del más antiguo: se perdería
--     la fecha de ingreso y el primer contacto, que alimentan la atribución.
--   - Índice sobre ig_username a secas: "@ana" y "Ana" pasarían como
--     personas distintas.
--   - Fusionar también por nombre: dos personas pueden llamarse igual.
--
-- Idempotente: una segunda corrida no encuentra grupos, la normalización no
-- cambia nada y el índice ya existe.
--
-- Para ver antes qué se va a fusionar, corre solo esta consulta. No usa la
-- función ig_normalizado, así que sirve antes de correr la migración:
--
--   SELECT lower(ltrim(btrim(ig_username), '@')) AS ig, count(*) AS leads,
--          string_agg(stage || ' / ' || coalesce(u.full_name, 'sin setter'), ' · '
--                     ORDER BY l.created_at) AS etapas_y_setters
--   FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
--   WHERE nullif(lower(ltrim(btrim(ig_username), '@')), '') IS NOT NULL
--   GROUP BY l.client_id, 1
--   HAVING count(*) > 1
--   ORDER BY 1;

SELECT set_config('lock_timeout', '10s', true);

-- ── 1. Normalización ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ig_normalizado(valor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT nullif(lower(ltrim(btrim(valor), '@')), '')
$$;

GRANT EXECUTE ON FUNCTION ig_normalizado(TEXT) TO authenticated;

-- ── 2. Fusión ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  etapas_por_defecto CONSTANT TEXT[] := ARRAY[
    'nuevo_contacto', 'seguimiento', 'conversando', 'micro_vsl_enviado', 'vsl_chat',
    'pitcheado', 'calendly_enviado', 'propuesta_enviada', 'agendado', 'no_calificado', 'cierre'
  ];
  g record;
  fk record;
  dup_id UUID;
  keep_id UUID;
  pr leads%ROWTYPE;
  setter UUID;
  notas TEXT;
  etiquetas TEXT[];
  editado TIMESTAMPTZ;
  telefono TEXT;
  columnas TEXT;
  grupos INT := 0;
  borrados INT := 0;
BEGIN
  SELECT string_agg(format('%1$I = COALESCE(k.%1$I, d.%1$I)', column_name), ', ')
  INTO columnas
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'leads'
    AND is_generated = 'NEVER'
    AND column_name NOT IN (
      'id', 'client_id', 'created_at', 'updated_at', 'ig_username',
      'stage', 'assigned_to', 'next_follow_up_date', 'follow_up_count', 'agenda_at',
      'notes', 'events', 'phone', 'phone_e164'
    );

  DROP TABLE IF EXISTS _leads_a_fusionar;
  CREATE TEMP TABLE _leads_a_fusionar AS SELECT * FROM leads WHERE false;
  DROP TABLE IF EXISTS _grupo;
  CREATE TEMP TABLE _grupo (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    assigned_to UUID,
    rango BIGINT,
    actividad BIGINT
  );

  FOR g IN
    SELECT l.client_id, ig_normalizado(l.ig_username) AS ig
    FROM leads l
    WHERE ig_normalizado(l.ig_username) IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    -- Los leads del grupo, con su rango en el pipeline y su actividad.
    TRUNCATE _grupo;
    INSERT INTO _grupo
    SELECT l.id, l.created_at, l.updated_at, l.assigned_to,
           COALESCE(
             (SELECT e.ord
              FROM clients c,
                   jsonb_array_elements(COALESCE(c.pipeline_stages, '[]'::jsonb)) WITH ORDINALITY e(v, ord)
              WHERE c.id = l.client_id AND e.v->>'id' = l.stage),
             array_position(etapas_por_defecto, l.stage),
             0
           ) AS rango,
           (SELECT count(*) FROM lead_activity_logs a WHERE a.lead_id = l.id) AS actividad
    FROM leads l
    WHERE l.client_id = g.client_id
      AND ig_normalizado(l.ig_username) = g.ig;

    SELECT id INTO keep_id FROM _grupo ORDER BY created_at, id LIMIT 1;

    SELECT l.* INTO pr
    FROM leads l
    JOIN _grupo x ON x.id = l.id
    ORDER BY x.rango DESC, x.actividad DESC, x.updated_at DESC NULLS LAST, x.created_at
    LIMIT 1;

    setter := COALESCE(
      pr.assigned_to,
      (SELECT assigned_to FROM _grupo WHERE assigned_to IS NOT NULL
       ORDER BY actividad DESC, updated_at DESC NULLS LAST LIMIT 1)
    );

    SELECT string_agg(n.notes, E'\n\n' ORDER BY n.primera)
    INTO notas
    FROM (
      SELECT btrim(l.notes) AS notes, min(l.created_at) AS primera
      FROM leads l JOIN _grupo x ON x.id = l.id
      WHERE nullif(btrim(l.notes), '') IS NOT NULL
      GROUP BY btrim(l.notes)
    ) n;

    SELECT COALESCE(array_agg(DISTINCT t), '{}')
    INTO etiquetas
    FROM leads l JOIN _grupo x ON x.id = l.id, unnest(COALESCE(l.events, '{}')) t;

    SELECT max(updated_at) INTO editado FROM _grupo;

    -- Copia de los que se van, antes de tocarlos.
    TRUNCATE _leads_a_fusionar;
    INSERT INTO _leads_a_fusionar
    SELECT l.* FROM leads l JOIN _grupo x ON x.id = l.id WHERE l.id <> keep_id;

    -- Todo lo que apunta a ellos pasa al que queda.
    FOR dup_id IN SELECT id FROM _leads_a_fusionar LOOP
      FOR fk IN
        SELECT c.conrelid::regclass AS tabla, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = 'public.leads'::regclass
          AND array_length(c.conkey, 1) = 1
      LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tabla, fk.columna, fk.columna)
            USING keep_id, dup_id;
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE '081: % no se movió en % (restricción única)', dup_id, fk.tabla;
        END;
      END LOOP;

      -- Sin FK a propósito (075).
      IF to_regclass('public.lead_events') IS NOT NULL THEN
        UPDATE lead_events SET lead_id = keep_id WHERE lead_id = dup_id;
      END IF;
      IF to_regclass('public.webhook_logs') IS NOT NULL THEN
        UPDATE webhook_logs SET lead_id = keep_id WHERE lead_id = dup_id;
      END IF;
    END LOOP;

    -- Se borran antes de copiar el teléfono (índice único de la 061).
    DELETE FROM leads WHERE id IN (SELECT id FROM _leads_a_fusionar);
    borrados := borrados + (SELECT count(*) FROM _leads_a_fusionar);

    -- Columnas vacías del que queda, del lead más antiguo al más nuevo.
    FOR dup_id IN SELECT id FROM _leads_a_fusionar ORDER BY created_at, id LOOP
      EXECUTE format(
        'UPDATE leads k SET %s FROM _leads_a_fusionar d WHERE k.id = $1 AND d.id = $2',
        columnas
      ) USING keep_id, dup_id;
    END LOOP;

    -- Flujo de trabajo del lead más avanzado.
    UPDATE leads k
    SET stage = pr.stage,
        assigned_to = setter,
        next_follow_up_date = pr.next_follow_up_date,
        follow_up_count = pr.follow_up_count,
        agenda_at = COALESCE(pr.agenda_at, k.agenda_at,
                             (SELECT max(agenda_at) FROM _leads_a_fusionar)),
        notes = notas,
        events = etiquetas,
        ig_username = g.ig,
        updated_at = GREATEST(COALESCE(editado, now()), k.updated_at)
    WHERE k.id = keep_id;

    SELECT phone INTO telefono
    FROM _leads_a_fusionar
    WHERE nullif(btrim(phone), '') IS NOT NULL
    ORDER BY created_at
    LIMIT 1;
    IF telefono IS NOT NULL THEN
      BEGIN
        UPDATE leads SET phone = telefono
        WHERE id = keep_id AND nullif(btrim(phone), '') IS NULL;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '081: el teléfono de % ya es de otro lead, no se copió', keep_id;
      END;
    END IF;

    grupos := grupos + 1;
  END LOOP;

  DROP TABLE _grupo;
  DROP TABLE _leads_a_fusionar;
  RAISE NOTICE '081: % grupos fusionados, % leads repetidos borrados', grupos, borrados;
END $$;

-- ── 3. Usuarios guardados con "@" o con mayúsculas ────────────────────────

UPDATE leads
SET ig_username = ig_normalizado(ig_username)
WHERE ig_username IS NOT NULL
  AND ig_username IS DISTINCT FROM ig_normalizado(ig_username);

-- ── 4. Índice único ───────────────────────────────────────────────────────

DO $$
DECLARE
  repetidos INT;
BEGIN
  SELECT count(*) INTO repetidos
  FROM (
    SELECT 1 FROM leads
    WHERE ig_normalizado(ig_username) IS NOT NULL
    GROUP BY client_id, ig_normalizado(ig_username)
    HAVING count(*) > 1
  ) d;

  IF repetidos > 0 THEN
    RAISE EXCEPTION 'Quedan % usuarios de Instagram repetidos: la fusión no terminó. Revisa los avisos y vuelve a correr la migración.', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_client_ig
  ON leads (client_id, ig_normalizado(ig_username))
  WHERE ig_normalizado(ig_username) IS NOT NULL;

COMMENT ON INDEX uq_leads_client_ig IS
  'Un lead por Instagram en cada cliente. Ver supabase/081 y src/lib/lead-por-instagram.ts.';

-- Verificación: debe devolver 0 filas.
SELECT client_id, ig_normalizado(ig_username) AS ig, count(*)
FROM leads
WHERE ig_normalizado(ig_username) IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1;
