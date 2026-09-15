-- =====================================================
-- 072 — Políticas RLS sin llamadas por fila, índices y conteo por pieza
-- =====================================================
--
-- EL PROBLEMA
-- Todo el CRM se sentía lento, y más en los clientes grandes (Mane: 8.418
-- leads y 17.492 interactions). La causa principal está en la base, no en el
-- código: las políticas RLS escriben `get_user_type() = 'agency'` y
-- `client_id = get_user_client_id()` sin envolver. Esas dos funciones son
-- SECURITY DEFINER y consultan `users`, así que Postgres no puede inlinarlas
-- y las ejecuta UNA VEZ POR FILA (en leads, interactions y content_pieces
-- hasta tres veces, porque client_read y client_own_data son idénticas y se
-- evalúan las dos). `users`, una tabla de 10 filas, acumulaba 1.880 millones
-- de idx_scan. Además la estimación de filas se derrumba (126 donde hay
-- 8.418) y el planner termina en seq scan o en nested loop.
--
-- Medido como `authenticated` con el JWT de un admin, en caliente:
--   - página de leads de Mane: 432 ms → 31 ms (25.707 → 602 buffers)
--   - cuerpo de metrics_interactions_by_day a 90 días: 1.664 ms → 43 ms
--
-- QUÉ SE DECIDIÓ
-- 1. Envolver las funciones en `(SELECT ...)`. Así Postgres las evalúa una
--    sola vez por consulta (InitPlan) y usa el valor como constante. No cambia
--    la semántica: el usuario y su tipo no cambian dentro de una consulta.
--    Se hace con ALTER POLICY sobre el texto que devuelve pg_policies, en vez
--    de reescribir a mano las 59 políticas: el texto deparseado se transforma
--    igual en todas y no hay riesgo de copiar mal una condición. El regex usa
--    `(?<!SELECT )` para no volver a envolver lo que ya está envuelto (el
--    deparse de una política envuelta escribe `( SELECT get_user_type() AS
--    get_user_type)`), así que una segunda corrida no cambia nada.
--    Se descartó pasar las funciones a SECURITY INVOKER: si `users` llega a
--    tener RLS, una función INVOKER que lee `users` quedaría recursiva.
-- 2. Borrar las políticas client_read de leads, interactions, content_pieces y
--    sales_calls, SOLO si siguen siendo idénticas a client_own_data de la
--    misma tabla (mismo comando, roles, tipo y condición). Si alguien las
--    cambió, se dejan. En las demás tablas client_read es la única política de
--    cliente y no se toca.
-- 3. Índices para los filtros que hoy hacen seq scan:
--    - leads (client_id, ig_username): los webhooks buscan el lead por usuario
--      de Instagram (unas 20 mil llamadas, "Rows Removed by Filter: 8432").
--    - interactions (client_id, ig_username, bot_triggered_at): mismo patrón.
--    - webhook_logs (source, received_at DESC): el límite por minuto de la API
--      del agente y el cron process-webhooks recorrían las 3.965 páginas.
--    CREATE INDEX normal y no CONCURRENTLY: CONCURRENTLY no corre dentro de
--    una transacción (el editor SQL ejecuta el script en una) y estas tablas
--    son chicas, el bloqueo dura milisegundos.
-- 4. Borrar dos índices duplicados sin uso, SOLO si sigue existiendo el UNIQUE
--    que los cubre: idx_incoming_messages_mid (igual a
--    incoming_messages_message_mid_key) e idx_leads_client_phone_e164 (igual a
--    uq_leads_client_phone_e164). Cada índice de más cuesta en cada escritura.
-- 5. interaction_counts_by_piece: la pestaña Contenido bajaba las 17.492
--    interactions (unos 13 MB) solo para contar chats por pieza. La función
--    devuelve una fila por pieza (38 para Mane). SECURITY INVOKER para que la
--    RLS se aplique igual que en la consulta que reemplaza. El código cae a la
--    ruta anterior si la función aún no existe.
--
-- ORDEN
-- Las políticas y los DROP INDEX van al final a propósito: toman un bloqueo
-- exclusivo que, dentro de la transacción del editor, se mantiene hasta el
-- final. Así ese bloqueo dura lo mínimo y no espera a que se construyan los
-- índices. El lock_timeout hace que, si una consulta larga tiene tomada una
-- tabla, la migración falle entera (sin dejar nada a medias) en vez de dejar
-- en espera a todo el CRM detrás de ella. Si pasa, basta con volver a correrla.
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE y chequeos dentro del DO.
-- Después de correrla, revisar pg_policies y volver a medir las pantallas.

SELECT set_config('lock_timeout', '10s', true);

-- ── 3. Índices ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_client_ig_username
  ON public.leads (client_id, ig_username);

CREATE INDEX IF NOT EXISTS idx_interactions_client_ig_username
  ON public.interactions (client_id, ig_username, bot_triggered_at);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_source_received
  ON public.webhook_logs (source, received_at DESC);

-- ── 5. Conteo de chats por pieza ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.interaction_counts_by_piece(p_client_id uuid)
RETURNS TABLE (content_id uuid, chats bigint, conversaciones bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- "conversaciones" sigue la misma regla que la pestaña Contenido y el CRM:
  -- la promoción a lead calificado pisa la clasificación en el lugar, así que
  -- quien calificó también tuvo una conversación real.
  SELECT
    i.content_id,
    count(*) AS chats,
    count(*) FILTER (WHERE i.classification IN ('conversacion_real', 'lead_calificado')) AS conversaciones
  FROM interactions i
  WHERE i.client_id = p_client_id
    AND i.content_id IS NOT NULL
  GROUP BY i.content_id;
$$;

GRANT EXECUTE ON FUNCTION public.interaction_counts_by_piece(uuid) TO authenticated;

COMMENT ON FUNCTION public.interaction_counts_by_piece(uuid) IS
  'Chats y conversaciones reales por pieza de contenido de un cliente, para no bajar todas las interactions al navegador. Ver supabase/072.';

ANALYZE public.leads;
ANALYZE public.interactions;
ANALYZE public.webhook_logs;

-- ── 1, 2 y 4. Políticas e índices duplicados ──────────────────────────────
DO $$
DECLARE
  t text;
  p record;
  u text;
  c text;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);

  -- 2. client_read duplicadas. Van ANTES del bucle de reescritura: si se
  -- borraran durante el bucle, el cursor ya abierto intentaría alterar una
  -- política que dejó de existir. Se comparan los textos originales; si una
  -- corrida anterior ya las hubiera envuelto, las dos quedarían envueltas igual
  -- y la comparación seguiría valiendo.
  FOREACH t IN ARRAY ARRAY['leads', 'interactions', 'content_pieces', 'sales_calls'] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies a
      JOIN pg_policies b
        ON b.schemaname = a.schemaname
       AND b.tablename = a.tablename
       AND b.policyname = 'client_own_data'
      WHERE a.schemaname = 'public'
        AND a.tablename = t
        AND a.policyname = 'client_read'
        AND a.permissive = b.permissive
        AND a.roles = b.roles
        AND a.cmd = b.cmd
        AND a.qual IS NOT DISTINCT FROM b.qual
        AND a.with_check IS NOT DISTINCT FROM b.with_check
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS client_read ON public.%I', t);
      RAISE NOTICE '072: borrada client_read duplicada en %', t;
    END IF;
  END LOOP;

  -- 1. Envolver las funciones en (SELECT ...).
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(get_user_type|get_user_client_id)\(\)|auth\.uid\(\)'
  LOOP
    IF p.qual IS NOT NULL THEN
      u := p.qual;
      u := regexp_replace(u, '(?<!SELECT )get_user_type\(\)', '(SELECT get_user_type())', 'g');
      u := regexp_replace(u, '(?<!SELECT )get_user_client_id\(\)', '(SELECT get_user_client_id())', 'g');
      u := regexp_replace(u, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
      IF u IS DISTINCT FROM p.qual THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', p.policyname, p.schemaname, p.tablename, u);
      END IF;
    END IF;

    IF p.with_check IS NOT NULL THEN
      c := p.with_check;
      c := regexp_replace(c, '(?<!SELECT )get_user_type\(\)', '(SELECT get_user_type())', 'g');
      c := regexp_replace(c, '(?<!SELECT )get_user_client_id\(\)', '(SELECT get_user_client_id())', 'g');
      c := regexp_replace(c, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
      IF c IS DISTINCT FROM p.with_check THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', p.policyname, p.schemaname, p.tablename, c);
      END IF;
    END IF;
  END LOOP;

  -- 4. Índices duplicados: solo si el UNIQUE equivalente sigue ahí.
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'incoming_messages'
      AND indexname = 'incoming_messages_message_mid_key'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX % USING btree (message_mid)'
  ) THEN
    DROP INDEX IF EXISTS public.idx_incoming_messages_mid;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'leads'
      AND indexname = 'uq_leads_client_phone_e164'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX % USING btree (client_id, phone_e164) WHERE (phone_e164 IS NOT NULL)'
  ) THEN
    DROP INDEX IF EXISTS public.idx_leads_client_phone_e164;
  END IF;
END $$;
