-- =====================================================
-- 048 — El progreso del ciclo del setter en una sola consulta
-- =====================================================
-- Enviar el reporte diario se sentía colgado: un setter lo mandó dos veces
-- porque la pantalla quedó en "Enviando..." varios minutos, y el segundo envío
-- entró con 0/0/0 (el primer reporte ya había reiniciado el ciclo, así que la
-- ventana del segundo medía cuatro minutos vacíos).
--
-- Tres arreglos acá:
--
-- 1. `setter_cycle_progress` reemplaza el SELECT que traía TODAS las filas de
--    lead_activity_logs del ciclo a Node para contarlas en memoria. Con 105
--    leads tocados más seguimientos son cientos o miles de filas por llamada,
--    y esa llamada ocurría hasta cinco veces por click. Peor: PostgREST corta
--    en 1000 filas por defecto, así que un ciclo largo devolvía conteos
--    truncados en silencio, sin error.
--
-- 2. El índice de lead_activity_logs era (user_id, created_at) pero la consulta
--    filtra por user_id + client_id + created_at. Se agrega el índice completo.
--
-- 3. Un índice único (user_id, cycle_started_at) para que dos envíos
--    simultáneos del mismo ciclo no puedan insertar dos filas. Cada reporte
--    abre un ciclo nuevo, así que un setter nunca tiene dos reportes con el
--    mismo inicio de ciclo salvo que sea un duplicado.
--
-- SECURITY INVOKER a propósito: corre con los permisos de quien llama, así que
-- la política RLS de lead_activity_logs (get_user_type() = 'agency') se sigue
-- aplicando igual que en la consulta suelta que reemplaza.
--
-- Seguro de re-ejecutar: cada sentencia es idempotente.

CREATE INDEX IF NOT EXISTS lead_activity_logs_user_client_created_idx
  ON lead_activity_logs(user_id, client_id, created_at);

-- El tope por lead/etapa (p_max_followups_per_lead) refleja
-- MAX_FOLLOWUPS_PER_LEAD_STAGE en src/lib/actions/setter-app.ts: un mismo lead
-- re-marcado en la misma etapa suma como máximo dos veces, para que la cuota no
-- se infle spameando un solo lead en vez de trabajar el pipeline a lo ancho.
CREATE OR REPLACE FUNCTION public.setter_cycle_progress(
  p_user_id UUID,
  p_client_id UUID,
  p_cycle_start TIMESTAMPTZ,
  p_max_followups_per_lead INTEGER DEFAULT 2
)
RETURNS TABLE (leads_touched BIGINT, agendas_set BIGINT, followups JSONB)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ciclo AS (
    SELECT lead_id, action_type, stage_at_time
      FROM lead_activity_logs
     WHERE user_id = p_user_id
       AND client_id = p_client_id
       AND created_at >= p_cycle_start
  ),
  -- Cuántas veces se tocó cada lead en cada etapa, antes de aplicar el tope.
  por_lead_etapa AS (
    SELECT stage_at_time, lead_id, count(*) AS toques
      FROM ciclo
     WHERE action_type = 'seguimiento'
     GROUP BY stage_at_time, lead_id
  )
  SELECT
    (SELECT count(DISTINCT lead_id) FROM ciclo),
    (SELECT count(DISTINCT lead_id) FROM ciclo
      WHERE action_type = 'contacto' AND stage_at_time = 'agendado'),
    -- Objeto {etapa: total}; el código mapea sólo las etapas que muestra, así
    -- que agregar o quitar etapas en TS no obliga a tocar esta función.
    COALESCE(
      (SELECT jsonb_object_agg(stage_at_time, total)
         FROM (
           SELECT stage_at_time,
                  sum(least(toques, p_max_followups_per_lead)) AS total
             FROM por_lead_etapa
            GROUP BY stage_at_time
         ) s),
      '{}'::jsonb
    );
$$;

GRANT EXECUTE ON FUNCTION public.setter_cycle_progress(UUID, UUID, TIMESTAMPTZ, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.setter_cycle_progress IS
  'Leads tocados, agendas y seguimientos por etapa de un ciclo de setter, en una sola consulta en vez de traer todo lead_activity_logs a Node. Ver src/lib/actions/setter-app.ts.';

-- ── Limpieza de los reportes duplicados que dejó el bug ─────────────────────
-- Un reporte con los tres contadores en cero nunca es legítimo: para que la
-- app pida el reporte el setter tuvo que cruzar min_leads_touched (100 por
-- defecto). Un 0/0/0 sólo aparece cuando se reenvía el mismo reporte después
-- de que el primero ya reinició el ciclo. Ensucia el feed de marketing en
-- /reports y desplaza el inicio del ciclo siguiente.
DELETE FROM daily_setter_reports
 WHERE leads_touched = 0
   AND agendas_set = 0
   AND followups_total = 0;

-- Duplicados exactos del mismo ciclo (dos envíos que alcanzaron a leer el
-- mismo cycle_started_at antes de que el primero se guardara). Se conserva el
-- más antiguo, que es el que abrió el ciclo siguiente.
DELETE FROM daily_setter_reports d
 WHERE EXISTS (
   SELECT 1 FROM daily_setter_reports otro
    WHERE otro.user_id = d.user_id
      AND otro.cycle_started_at = d.cycle_started_at
      AND (otro.submitted_at, otro.id) < (d.submitted_at, d.id)
 );

-- Con la tabla ya deduplicada, esto vuelve imposible el doble insert: cada
-- reporte abre un ciclo nuevo, así que dos reportes del mismo setter con el
-- mismo inicio de ciclo son por definición el mismo reporte enviado dos veces.
-- submitDailyReport trata el 23505 como "ya estaba enviado", no como error.
CREATE UNIQUE INDEX IF NOT EXISTS daily_setter_reports_user_cycle_uniq
  ON daily_setter_reports(user_id, cycle_started_at);
