-- Lo que faltaba del Pipeline de Agendas: ficha de triaje, reporte aprobado y
-- colas con dueño
--
-- EL PROBLEMA
-- La especificación del pipeline (artifact "Pipeline de Agendas BIZ") pedía que
-- el triaje se cerrara GUARDANDO UNA FICHA que el closer lee antes de la
-- llamada, no marcando un check. Lo que quedó construido en la 053 era un aviso
-- con un botón "Revisada": producía exactamente el problema que la
-- especificación advertía, un registro diciendo que el triaje se hizo sin
-- ningún entregable. Tampoco había dónde guardar si el reporte de la llamada
-- estaba en borrador o aprobado, ni a quién le tocaba cada tarea.
--
-- QUÉ SE AGREGA
--
-- agenda_records.triaje          La ficha completa en JSONB: califica,
--                                temperatura, objeción previsible, ángulo para
--                                el closer y prioridad. JSONB y no cinco
--                                columnas porque la ficha va a cambiar de
--                                preguntas y nadie la filtra campo por campo.
-- agenda_records.triaje_at / triaje_por
--                                Cuándo y quién la guardó.
-- agenda_records.triaje_leido_at Cuándo la abrió el closer. El triaje no
--                                termina cuando se guarda, termina cuando el
--                                closer lo leyó.
-- agenda_records.reporte_estado  NULL (sin grabación) | borrador | aprobado.
--                                El borrador lo arma el sistema desde el
--                                resumen de Fathom; aprobado es lo único que
--                                cuenta para el panel de marketing.
--
-- system_tasks.asignado_a        Quién la ve en el popup. Los admins ven todas
--                                las colas en la pantalla de Tareas, pero el
--                                aviso suena solo para el responsable (ver 039).
-- system_tasks.escalada_at       Cuándo se escaló (tercera postergación o
--                                vencimiento). Evita avisar dos veces.
--
-- Se descartó crear las columnas snooze_hasta / snooze_count que dibujaba la
-- especificación: visible_desde y pospuesta_veces de la 053 son exactamente
-- eso y ya tienen datos.
--
-- Idempotente.

ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS triaje JSONB;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS triaje_at TIMESTAMPTZ;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS triaje_por UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS triaje_leido_at TIMESTAMPTZ;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS reporte_estado TEXT;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS reporte_aprobado_at TIMESTAMPTZ;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS reporte_aprobado_por UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN agenda_records.triaje IS
  'Ficha de triaje: {califica, temperatura, objecion_prevista, angulo, prioridad}. La guarda la dirección de ventas y la lee el closer.';
COMMENT ON COLUMN agenda_records.triaje_leido_at IS
  'Cuándo el closer abrió la ficha. NULL = el closer todavía no la vio.';
COMMENT ON COLUMN agenda_records.reporte_estado IS
  'NULL = sin grabación | borrador = armado desde Fathom, falta revisar | aprobado = revisado por la dirección de ventas.';

ALTER TABLE system_tasks ADD COLUMN IF NOT EXISTS asignado_a UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE system_tasks ADD COLUMN IF NOT EXISTS escalada_at TIMESTAMPTZ;

COMMENT ON COLUMN system_tasks.tipo IS
  'triaje_agenda (dirección de ventas) | asociar_lead (setter) | reporte_llamada (dirección de ventas).';
COMMENT ON COLUMN system_tasks.asignado_a IS
  'Responsable de la tarea. NULL = sin responsable definido: la ven los admins y, si es asociar_lead, los setters del cliente.';

-- El popup pide lo pendiente de una persona.
CREATE INDEX IF NOT EXISTS idx_system_tasks_asignado
  ON system_tasks(asignado_a, vence_at)
  WHERE estado = 'pendiente';

-- ── Datos existentes ────────────────────────────────────────────────────────

-- El plazo correcto es "24 horas desde que se agendó o 2 horas antes de la
-- llamada, lo que ocurra primero". La 053 solo usaba las 24 horas, así que una
-- llamada agendada para mañana temprano vencía después de ocurrir.
UPDATE system_tasks t
SET vence_at = LEAST(a.created_at + interval '24 hours', a.hora_agenda - interval '2 hours')
FROM agenda_records a
WHERE a.id = t.agenda_record_id
  AND t.tipo = 'triaje_agenda'
  AND t.estado = 'pendiente'
  AND a.hora_agenda IS NOT NULL;

-- Los triajes existentes pasan a la dirección de ventas del cliente.
UPDATE system_tasks t
SET asignado_a = ta.user_id
FROM team_assignments ta
WHERE ta.client_id = t.client_id
  AND ta.responsibility = 'sales_direction'
  AND ta.is_primary
  AND t.asignado_a IS NULL
  AND t.tipo IN ('triaje_agenda', 'reporte_llamada');

-- Las agendas que ya tienen resumen de Fathom quedan en borrador para que
-- alguien las apruebe. El texto del borrador lo completa el barrido.
UPDATE agenda_records
SET reporte_estado = 'borrador'
WHERE fathom_resumen IS NOT NULL
  AND reporte_estado IS NULL;
