-- =====================================================
-- 080 — Fusionar agendas duplicadas de un mismo lead
-- =====================================================
--
-- EL PROBLEMA
-- Después de la 079, los cuatro leads que reportó Luli (natta_v_b,
-- melinaleis, vivibelen.nm, oroenlasmanos) quedaron con dos agendas cada uno
-- para la misma reserva:
--   - la del calendario: con hora_agenda y calendly_uuid.
--   - otra creada minutos después: misma fecha_agenda, sin hora y sin uuid.
--
-- La segunda la crea ensureAgendaRecordForLead (src/lib/actions/leads.ts)
-- cuando alguien pasa un lead a "Agendado". Solo revisa si ESE lead ya tiene
-- agenda. La del calendario estaba asociada al lead duplicado que creó el
-- triaje (ver 079), así que al marcar Magui su lead original se creó otra. Al
-- fusionar los leads, las dos quedaron en el mismo. La causa ya está corregida
-- en el código (la 079 y su commit), pero las filas siguen repetidas y la
-- reserva se cuenta doble en métricas y en el pipeline de Agendas.
--
-- QUÉ SE DECIDIÓ
-- Para cada lead y fecha_agenda, se queda la agenda del calendario (la que
-- tiene calendly_uuid) y se le fusionan las filas del mismo lead y fecha que
-- no tienen ni uuid ni hora: la huella de ensureAgendaRecordForLead.
--   - Cada columna vacía de la agenda que queda se completa con la del
--     duplicado (setter, CTA, comentarios, closer...). Lo que ya tenía no se
--     pisa.
--   - El estado: si la que queda sigue "Pendiente" y el duplicado ya tiene un
--     resultado, gana el resultado; si no, se mantiene el de la que queda.
--   - Lo que apunta al duplicado (tareas de triaje, llamadas, grabaciones) pasa
--     a la que queda, y el duplicado se borra.
--
-- Se descartó:
--   - Fusionar por nombre o por fecha sin lead: sin lead_id en común no hay
--     forma segura de saber que es la misma persona.
--   - Quedarse con la fila manual: no tiene hora ni uuid, y sin uuid las
--     cancelaciones y reagendamientos del calendario no la encuentran.
--
-- Idempotente: una segunda corrida no encuentra pares con esa huella.
--
-- Para ver antes qué se va a fusionar, corre solo esta consulta:
--
--   SELECT l.ig_username, d.fecha_agenda, d.estado AS estado_duplicado,
--          k.estado AS estado_que_queda, k.hora_agenda
--   FROM agenda_records d
--   JOIN agenda_records k
--     ON k.lead_id = d.lead_id AND k.fecha_agenda = d.fecha_agenda
--    AND k.calendly_uuid IS NOT NULL
--   LEFT JOIN leads l ON l.id = d.lead_id
--   WHERE d.lead_id IS NOT NULL
--     AND d.calendly_uuid IS NULL
--     AND d.hora_agenda IS NULL
--   ORDER BY d.fecha_agenda;

SELECT set_config('lock_timeout', '10s', true);

DO $$
DECLARE
  par record;
  fk record;
  columnas text;
  fusionadas INT := 0;
BEGIN
  -- Toda columna de la agenda que no sea identidad, dueño, estado o marca de
  -- tiempo: se completa con COALESCE(la que queda, el duplicado).
  SELECT string_agg(format('%1$I = COALESCE(k.%1$I, d.%1$I)', column_name), ', ')
  INTO columnas
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'agenda_records'
    AND column_name NOT IN ('id', 'client_id', 'lead_id', 'estado', 'created_at', 'updated_at')
    AND is_generated = 'NEVER';

  FOR par IN
    SELECT d.id AS drop_id,
           (SELECT k.id
            FROM agenda_records k
            WHERE k.lead_id = d.lead_id
              AND k.fecha_agenda = d.fecha_agenda
              AND k.calendly_uuid IS NOT NULL
            ORDER BY (k.cancelada_at IS NULL) DESC, k.created_at, k.id
            LIMIT 1) AS keep_id
    FROM agenda_records d
    WHERE d.lead_id IS NOT NULL
      AND d.fecha_agenda IS NOT NULL
      AND d.calendly_uuid IS NULL
      AND d.hora_agenda IS NULL
  LOOP
    CONTINUE WHEN par.keep_id IS NULL;

    -- 1. Columnas vacías y estado.
    EXECUTE format(
      'UPDATE agenda_records k SET %s,
         estado = CASE
           WHEN coalesce(k.estado, ''Pendiente'') = ''Pendiente'' THEN COALESCE(d.estado, k.estado)
           ELSE k.estado
         END,
         updated_at = now()
       FROM agenda_records d
       WHERE k.id = $1 AND d.id = $2',
      columnas
    ) USING par.keep_id, par.drop_id;

    -- 2. Lo que apunta al duplicado pasa a la que queda. Una restricción
    --    única que choque (p. ej. una tarea de triaje pendiente por agenda)
    --    deja esas filas: el borrado aplica su regla (CASCADE o SET NULL).
    FOR fk IN
      SELECT c.conrelid::regclass AS tabla, a.attname AS columna
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.agenda_records'::regclass
        AND array_length(c.conkey, 1) = 1
    LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tabla, fk.columna, fk.columna)
          USING par.keep_id, par.drop_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '080: % no se movió en % (restricción única)', par.drop_id, fk.tabla;
      END;
    END LOOP;

    -- 3. Fuera el duplicado.
    DELETE FROM agenda_records WHERE id = par.drop_id;
    fusionadas := fusionadas + 1;
  END LOOP;

  RAISE NOTICE '080: % agendas duplicadas fusionadas', fusionadas;
END $$;

-- Verificación: debe devolver 0 filas.
SELECT d.id, d.lead_id, d.fecha_agenda
FROM agenda_records d
WHERE d.lead_id IS NOT NULL
  AND d.calendly_uuid IS NULL
  AND d.hora_agenda IS NULL
  AND EXISTS (
    SELECT 1 FROM agenda_records k
    WHERE k.lead_id = d.lead_id
      AND k.fecha_agenda = d.fecha_agenda
      AND k.calendly_uuid IS NOT NULL
  );
