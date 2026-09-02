-- =====================================================
-- 042 — Un responsable de Notion puede ser más de una persona
-- =====================================================
-- La propiedad "Responsable" de la base es un select, y sus opciones dejaron
-- de ser una persona cada una:
--
--   Martin Senel     → una persona
--   Fabian Juarez    → una persona
--   Carol Soto       → una persona
--   Fabi - Martin    → DOS personas
--   Equipo           → TODO el equipo del cliente
--
-- El sync resolvía el nombre completo contra users.full_name y guardaba un
-- solo uuid en assigned_to. Con las dos últimas opciones no encontraba a nadie
-- y la tarea quedaba con assigned_to = null, así que no aparecía en "mis
-- tareas" ni en el aviso de pendientes de NINGUNA persona. Una tarea de todo
-- el equipo era justo la que no le sonaba a nadie.
--
-- assignees guarda a todas las personas que la tarea toca. assigned_to se
-- mantiene con la primera del grupo: hay código y consultas que ya lo usan
-- (índice de pendientes, notificación de asignación), y para el 90% de las
-- tareas —un solo responsable— sigue significando exactamente lo mismo.

ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS assignees UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN team_tasks.assignees IS
  'Todos los usuarios del CRM a los que apunta el responsable de Notion. Un nombre suelto deja un elemento; "Fabi - Martin" deja dos; "Equipo" deja a todo el roster del cliente. assigned_to es el primero de esta lista.';

-- "¿Qué tengo pendiente?" se pregunta en cada carga del panel y del workspace.
CREATE INDEX IF NOT EXISTS idx_team_tasks_assignees ON team_tasks USING GIN (assignees);

-- Backfill: las filas que ya tenían un responsable resuelto arrancan con ese
-- mismo usuario, para que nada cambie de dueño al aplicar la migración. El
-- resto se llena solo en el próximo sync.
UPDATE team_tasks
SET assignees = ARRAY[assigned_to]
WHERE assigned_to IS NOT NULL AND assignees = '{}';
