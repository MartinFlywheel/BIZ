-- Los reportes de llamada no pueden nacer vencidos
--
-- EL PROBLEMA
-- El barrido de la 070 fijaba el plazo de "aprobar reporte" en 24 horas desde
-- la hora de la llamada. Una grabación que llega (o se procesa) días después
-- creaba la tarea ya vencida. El popup mostraba todo lo vencido aunque se
-- pospusiera, así que la dirección de ventas apretaba "Posponer", la base lo
-- registraba y el aviso seguía ahí. Le pasó al reporte de Daniela Krumrick,
-- pospuesto dos veces sin efecto visible.
--
-- QUÉ SE DECIDIÓ
-- El código ya cambió: el plazo es 24 horas desde la llamada o desde que se
-- crea la tarea, lo que sea más tarde, y el popup solo mira visible_desde.
-- Esto corrige las tareas que ya existen con el plazo viejo. Se descartó
-- borrarlas y dejar que el barrido las recree: el índice único lo impediría
-- si quedan como "hecha", y se perdería el conteo de postergaciones.
--
-- Idempotente: una segunda corrida no encuentra tareas vencidas antes de nacer.

UPDATE system_tasks
SET vence_at = created_at + interval '24 hours'
WHERE tipo = 'reporte_llamada'
  AND estado = 'pendiente'
  AND vence_at < created_at + interval '24 hours';
