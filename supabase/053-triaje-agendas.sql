-- El triaje de 24 horas sobre las agendas nuevas
--
-- EL PROBLEMA
-- Una agenda entra sola desde Calendly, pero nadie se entera. Si el cruce
-- automatico no encontro el lead, esa agenda se queda muda hasta que alguien
-- abre la planilla por casualidad. El plan pedia que el director de ventas
-- tuviera que revisarla dentro de las 24 horas, con un aviso que no se pueda
-- ignorar sin decidir algo.
--
-- POR QUE UNA TABLA APARTE Y NO team_tasks
-- team_tasks espeja Notion: lo que hay ahi lo escribe el equipo en Notion y el
-- CRM lo lee. Meter tareas generadas por el sistema en esa tabla las mandaria
-- de vuelta a Notion o las haria desaparecer en la proxima sincronizacion,
-- segun como se resuelva el espejo. Estas tareas nacen y mueren en el CRM.
--
-- POR QUE NO SE BORRAN AL COMPLETARLAS
-- Quedan con estado 'hecha' para poder responder despues "cuantas agendas se
-- triaron dentro de las 24 horas", que es justo la pregunta que motivo esto.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS system_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Que tipo de trabajo pide. Hoy solo 'triaje_agenda'; se deja abierto porque
  -- el mismo mecanismo sirve para otros avisos que hoy no existen.
  tipo TEXT NOT NULL DEFAULT 'triaje_agenda',

  -- A que se refiere. Para el triaje, la agenda a revisar.
  agenda_record_id UUID REFERENCES agenda_records(id) ON DELETE CASCADE,

  estado TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | hecha | descartada

  -- Cuando vuelve a aparecer. Posponer empuja esta fecha; mientras sea futura,
  -- la tarea no se muestra. Es lo que hace que "pospuso" signifique algo en vez
  -- de solo cerrar el aviso.
  visible_desde TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- El limite de las 24 horas. Se guarda en vez de calcularlo para que siga
  -- siendo el limite original aunque la tarea se posponga tres veces.
  vence_at TIMESTAMPTZ,

  -- Cuantas veces se pospuso. Una tarea pospuesta cinco veces es una senal de
  -- que nadie la va a hacer, y conviene poder verlo.
  pospuesta_veces INT NOT NULL DEFAULT 0,

  completada_at TIMESTAMPTZ,
  completada_por UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una agenda no puede generar dos triajes. El barrido corre cada 15 minutos y
-- sin esto crearia uno nuevo en cada vuelta.
--
-- Sin WHERE a proposito: un indice parcial no sirve para resolver el ON CONFLICT
-- del upsert (ver 054). Los NULL igual se consideran distintos entre si en un
-- indice unico, asi que varias filas sin agenda_record_id siguen siendo validas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_tasks_agenda
  ON system_tasks(agenda_record_id, tipo);

-- La consulta que hace el popup: lo pendiente y ya visible, de un cliente.
CREATE INDEX IF NOT EXISTS idx_system_tasks_pendientes
  ON system_tasks(client_id, visible_desde)
  WHERE estado = 'pendiente';

ALTER TABLE system_tasks ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que el resto del CRM: quien puede ver al cliente puede ver
-- sus tareas de sistema. La tabla no guarda nada que no este ya en la agenda.
DROP POLICY IF EXISTS "system_tasks lectura" ON system_tasks;
CREATE POLICY "system_tasks lectura" ON system_tasks
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_tasks escritura" ON system_tasks;
CREATE POLICY "system_tasks escritura" ON system_tasks
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- ── Para encenderlo ─────────────────────────────────────────────────────────
-- El barrido que crea los triajes de las agendas nuevas:
--
--   SELECT cron.schedule(
--     'triage-sweep',
--     '*/15 * * * *',
--     $cmd$ SELECT private.call_cron_endpoint('/api/cron/triage-sweep') $cmd$
--   );
--
-- Esto reemplaza el bloque comentado al final de 037-pg-cron-scheduler.sql, que
-- quedo ahi esperando justamente a que la ruta y esta tabla existieran.
