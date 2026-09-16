-- =====================================================
-- 079 — Fusionar los leads duplicados que creó el triaje de agendas
-- =====================================================
--
-- EL PROBLEMA
-- Las setters reportaron agendas conseguidas por Magui que la app del celular
-- mostraba como de Luli, y leads que en el CRM aparecían dos veces, uno por
-- setter (natta_v_b, melinaleis, vivibelen.nm, oroenlasmanos).
--
-- La causa estaba en "Crear y asociar" del modal "Agenda sin lead"
-- (crearLeadDesdeAgenda en src/lib/actions/triage.ts). El formulario de
-- Calendly no pregunta el Instagram, así que el CRM no encontraba candidatos;
-- la setter escribía el @ a mano y la acción creaba un lead NUEVO con ese @
-- aunque ya existiera, asignado por el reparto balanceado. Resultado:
--   - lead original (de ManyChat): la setter que conversó, sin agenda.
--   - lead nuevo (del triaje): otra setter, con la agenda, el correo y el
--     teléfono.
-- La app del celular decide de quién es una agenda por el setter del lead
-- asociado, así que la agenda quedaba a nombre de la otra.
--
-- El código ya se corrigió: si el @, el correo o el teléfono ya son de un
-- lead, se asocia ese en vez de crear otro. Esta migración arregla los que ya
-- se crearon.
--
-- QUÉ SE DECIDIÓ
-- Se fusiona en el lead más antiguo del mismo cliente y mismo @ (sin importar
-- mayúsculas), que es el de la conversación y conserva su setter. Del lead
-- duplicado se traen el correo, el teléfono y el nombre si el original no los
-- tiene, y la etapa "agendado" con su fecha si el original no está más
-- adelante. Todo lo que apunta al duplicado (agendas, llamadas, mensajes,
-- historial, etc.) pasa al original, y el duplicado se borra.
--
-- Solo se toca un lead si tiene la huella del triaje: sin interacción de
-- ManyChat (interaction_id nulo) y con una agenda asociada a mano
-- (match_metodo = 'manual'). Un duplicado con conversación propia no se toca:
-- ese hay que revisarlo a mano.
--
-- Se descartó:
--   - Quedarse con el lead nuevo: perdería la conversación y el setter que
--     realmente consiguió la agenda.
--   - Una FK por FK escrita a mano: se recorren las FK hacia leads desde
--     pg_constraint para no dejar ninguna tabla afuera.
--
-- Idempotente: una segunda corrida no encuentra duplicados con esa huella.
--
-- Para ver antes qué se va a fusionar, corre solo esta consulta:
--
--   WITH d AS (
--     SELECT l.id, l.client_id, l.ig_username, l.assigned_to, l.interaction_id,
--            first_value(l.id) OVER w AS keep_id
--     FROM leads l
--     WHERE nullif(btrim(l.ig_username), '') IS NOT NULL
--     WINDOW w AS (PARTITION BY l.client_id, lower(btrim(l.ig_username))
--                  ORDER BY l.created_at, l.id)
--   )
--   SELECT d.ig_username, uk.full_name AS setter_que_queda, ud.full_name AS setter_del_duplicado
--   FROM d
--   JOIN leads k ON k.id = d.keep_id
--   LEFT JOIN users uk ON uk.id = k.assigned_to
--   LEFT JOIN users ud ON ud.id = d.assigned_to
--   WHERE d.id <> d.keep_id
--     AND d.interaction_id IS NULL
--     AND EXISTS (SELECT 1 FROM agenda_records a
--                 WHERE a.lead_id = d.id AND a.match_metodo = 'manual');

SELECT set_config('lock_timeout', '10s', true);

DO $$
DECLARE
  par record;
  fk record;
  dup leads%ROWTYPE;
  fusionados INT := 0;
BEGIN
  FOR par IN
    WITH d AS (
      SELECT l.id, l.interaction_id,
             first_value(l.id) OVER w AS keep_id
      FROM leads l
      WHERE nullif(btrim(l.ig_username), '') IS NOT NULL
      WINDOW w AS (PARTITION BY l.client_id, lower(btrim(l.ig_username))
                   ORDER BY l.created_at, l.id)
    )
    SELECT d.id AS drop_id, d.keep_id
    FROM d
    WHERE d.id <> d.keep_id
      AND d.interaction_id IS NULL
      AND EXISTS (
        SELECT 1 FROM agenda_records a
        WHERE a.lead_id = d.id AND a.match_metodo = 'manual'
      )
  LOOP
    -- 1. Todo lo que apunta al duplicado pasa al original. Si una tabla tiene
    --    una restricción única que choca, esas filas se dejan: el borrado del
    --    lead aplica su regla (SET NULL o CASCADE) como siempre.
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
          USING par.keep_id, par.drop_id;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '079: % no se movió en % (restricción única)', par.drop_id, fk.tabla;
      END;
    END LOOP;

    -- Tablas que guardan lead_id sin FK a propósito (migración 075).
    IF to_regclass('public.lead_events') IS NOT NULL THEN
      UPDATE lead_events SET lead_id = par.keep_id WHERE lead_id = par.drop_id;
    END IF;
    IF to_regclass('public.webhook_logs') IS NOT NULL THEN
      UPDATE webhook_logs SET lead_id = par.keep_id WHERE lead_id = par.drop_id;
    END IF;

    -- 2. Se guarda el duplicado y se borra antes de copiar el teléfono: el
    --    índice único de la 061 no admite dos leads con el mismo número.
    SELECT * INTO dup FROM leads WHERE id = par.drop_id;
    DELETE FROM leads WHERE id = par.drop_id;

    -- 3. El original se completa con lo que traía el duplicado.
    UPDATE leads k
    SET email = COALESCE(nullif(btrim(k.email), ''), dup.email),
        full_name = COALESCE(nullif(btrim(k.full_name), ''), dup.full_name),
        assigned_to = COALESCE(k.assigned_to, dup.assigned_to),
        stage = CASE
          WHEN dup.stage = 'agendado'
           AND k.stage NOT IN ('agendado', 'agenda_set', 'cierre', 'cliente', 'closed_won', 'no_calificado', 'closed_lost')
          THEN 'agendado'
          ELSE k.stage
        END,
        agenda_at = CASE
          WHEN dup.stage = 'agendado'
           AND k.stage NOT IN ('agendado', 'agenda_set', 'cierre', 'cliente', 'closed_won', 'no_calificado', 'closed_lost')
          THEN COALESCE(dup.agenda_at, k.agenda_at)
          ELSE COALESCE(k.agenda_at, dup.agenda_at)
        END,
        updated_at = now()
    WHERE k.id = par.keep_id;

    IF nullif(btrim(dup.phone), '') IS NOT NULL THEN
      BEGIN
        UPDATE leads SET phone = dup.phone
        WHERE id = par.keep_id AND nullif(btrim(phone), '') IS NULL;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '079: el teléfono de % ya es de otro lead, no se copió', par.keep_id;
      END;
    END IF;

    fusionados := fusionados + 1;
  END LOOP;

  RAISE NOTICE '079: % leads duplicados fusionados', fusionados;
END $$;

-- Verificación: debe devolver 0 filas.
SELECT l.client_id, lower(btrim(l.ig_username)) AS ig, count(*)
FROM leads l
WHERE nullif(btrim(l.ig_username), '') IS NOT NULL
  AND l.interaction_id IS NULL
  AND EXISTS (SELECT 1 FROM agenda_records a WHERE a.lead_id = l.id AND a.match_metodo = 'manual')
  AND EXISTS (
    SELECT 1 FROM leads o
    WHERE o.client_id = l.client_id
      AND lower(btrim(o.ig_username)) = lower(btrim(l.ig_username))
      AND (o.created_at, o.id) < (l.created_at, l.id)
  )
GROUP BY 1, 2;
