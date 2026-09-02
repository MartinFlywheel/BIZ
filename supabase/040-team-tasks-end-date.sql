-- =====================================================
-- 040 — Rango de fechas en las tareas de Notion
-- =====================================================
-- En Notion una propiedad de fecha puede ser un rango: "PERSONALIDAD" del 3 al
-- 8 de septiembre, "WHATSAAP (ADQUISICION)" del 22 al 27. El calendario de
-- Notion las dibuja como una barra que cruza esos días.
--
-- El sync del CRM leía únicamente `date.start` y descartaba `date.end`
-- (src/lib/services/notion.ts), así que una etapa de seis días llegaba como un
-- chip suelto en el primer día y el calendario del dashboard no se parecía en
-- nada al de Notion.
--
-- Se agrega `end_date` en vez de reinterpretar `due_date`: hoy `due_date` es el
-- inicio del rango y hay código que ya depende de eso (orden, badges, filtros).
-- Cambiarle el significado habría tocado todo eso para ganar nada.
--
-- Una tarea de un solo día deja `end_date` en NULL. Solo `isOverdue` cambia de
-- criterio: una tarea del 22 al 27 no está vencida el día 25, así que ahora
-- mira `end_date` cuando existe.

ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN team_tasks.end_date IS
  'Fin del rango de fechas de Notion. NULL cuando la tarea ocupa un solo día; en ese caso el día es due_date.';

-- El calendario pide un mes completo y necesita las tareas que EMPIEZAN antes
-- del mes pero siguen dentro de él, así que se consulta por los dos extremos.
CREATE INDEX IF NOT EXISTS idx_team_tasks_range ON team_tasks(client_id, due_date, end_date);
