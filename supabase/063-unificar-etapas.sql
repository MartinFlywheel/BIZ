-- 063 · Unificar las etapas del pipeline
--
-- Problema: convivían dos vocabularios de etapa. El tablero actual usa
-- nuevo_contacto, conversando, agendado, cierre, no_calificado, etc. (los 13
-- de LEAD_STAGES), pero varias vías seguían escribiendo el vocabulario
-- inglés original: el webhook antiguo de ManyChat y "Promover a lead" dejaban
-- 'new', el triaje 'agenda_set', el tercer "Perdido" 'closed_lost'. Esos
-- leads no aparecían en la pestaña CRM, no se limpiaban con
-- prune-stale-leads y no contaban en las métricas por etapa.
--
-- Solución: traducir los leads existentes al vocabulario actual y cambiar
-- las cuatro vías en el código (mismo commit). Equivalencias:
--
--   new         → nuevo_contacto
--   contacted   → conversando
--   agenda_set  → agendado
--   showed_up   → agendado   (si asistió queda en la agenda, no en la etapa)
--   no_show     → agendado   (ídem: el resultado vive en agenda_records)
--   closed_won  → cierre
--   closed_lost → no_calificado
--
-- Reversible: la etapa anterior queda en stage_antes_de_063. Si un cliente
-- tiene etapas propias (clients.pipeline_stages) que no incluyen la etapa de
-- destino, ese lead no se toca, porque lo mandaríamos a una etapa que su
-- tablero tampoco muestra.
--
-- Además, el trigger que calcula days_to_close solo conocía closed_won y
-- closed_lost; ahora también cierra con cierre y no_calificado.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_antes_de_063 TEXT;

-- Cuántos leads hay en cada etapa antigua, para saber qué se va a mover.
SELECT stage, count(*) AS leads
FROM leads
WHERE stage IN ('new', 'contacted', 'agenda_set', 'showed_up', 'no_show', 'closed_won', 'closed_lost')
GROUP BY stage
ORDER BY stage;

WITH destino AS (
  SELECT l.id,
         l.stage AS anterior,
         CASE l.stage
           WHEN 'new' THEN 'nuevo_contacto'
           WHEN 'contacted' THEN 'conversando'
           WHEN 'agenda_set' THEN 'agendado'
           WHEN 'showed_up' THEN 'agendado'
           WHEN 'no_show' THEN 'agendado'
           WHEN 'closed_won' THEN 'cierre'
           WHEN 'closed_lost' THEN 'no_calificado'
         END AS nueva,
         c.pipeline_stages
  FROM leads l
  JOIN clients c ON c.id = l.client_id
  WHERE l.stage IN ('new', 'contacted', 'agenda_set', 'showed_up', 'no_show', 'closed_won', 'closed_lost')
)
UPDATE leads l
SET stage = d.nueva,
    stage_antes_de_063 = d.anterior,
    -- Un lead que llega a agendado debe tener fecha de agenda; si no la
    -- tenía, se usa la última actualización como aproximación.
    agenda_at = CASE WHEN d.nueva = 'agendado' THEN COALESCE(l.agenda_at, l.updated_at) ELSE l.agenda_at END,
    updated_at = now()
FROM destino d
WHERE d.id = l.id
  AND d.nueva IS NOT NULL
  AND (
    d.pipeline_stages IS NULL
    OR jsonb_array_length(d.pipeline_stages) = 0
    OR d.pipeline_stages @> jsonb_build_array(jsonb_build_object('id', d.nueva))
  );

-- Trigger de cierre: reconoce también las etapas actuales.
CREATE OR REPLACE FUNCTION calculate_days_to_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IN ('closed_won', 'closed_lost', 'cierre', 'cliente', 'no_calificado') AND NEW.first_touch_at IS NOT NULL THEN
    NEW.days_to_close := EXTRACT(EPOCH FROM (COALESCE(NEW.closed_at, now()) - NEW.first_touch_at)) / 86400.0;
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Cuántos quedaron sin mover (clientes con etapas propias que no tienen la
-- etapa de destino). Si esta consulta devuelve filas, hay que revisarlos a
-- mano en la pestaña CRM del cliente.
SELECT c.name AS cliente, l.stage, count(*) AS leads
FROM leads l
JOIN clients c ON c.id = l.client_id
WHERE l.stage IN ('new', 'contacted', 'agenda_set', 'showed_up', 'no_show', 'closed_won', 'closed_lost')
GROUP BY c.name, l.stage
ORDER BY c.name, l.stage;
