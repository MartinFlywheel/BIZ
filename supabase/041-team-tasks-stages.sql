-- =====================================================
-- 041 — Etapas: filas de Notion que no son tareas
-- =====================================================
-- En la base de Notion conviven dos cosas distintas. Unas son tareas ("Mi
-- historia", "H | Dolor 1"): se hacen y se marcan. Otras son ETAPAS
-- ("PERSONALIDAD" del 3 al 7, "EXPERTIZ" del 14 al 18): describen el período
-- en el que está el lanzamiento, y adentro caen las tareas de esos días.
--
-- El CRM las trataba a todas igual, así que una etapa aparecía con casilla,
-- subía de urgencia como si venciera y competía con las tareas reales en el
-- tablero.
--
-- No se puede deducir cuál es cuál por la duración: "WHATSAAP (ADQUISICION)"
-- (etapa) y "Historias adquisición" (tarea) ocupan exactamente el mismo rango
-- del 20 al 24. Por eso el marcador es explícito y vive en Notion: una
-- propiedad de tipo select llamada "Tipo" con el valor "Etapa" en esas filas.
-- El sync la detecta sola, igual que ya detecta Estado, Prioridad y Fase, y si
-- la base no la tiene todo sigue funcionando como hasta ahora (is_stage queda
-- en false para todo).

ALTER TABLE team_tasks ADD COLUMN IF NOT EXISTS is_stage BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN team_tasks.is_stage IS
  'true cuando la fila de Notion es una etapa (un período del lanzamiento), no una tarea que se completa. Lo determina la propiedad "Tipo" de la base de Notion.';

-- El calendario y la lista piden las etapas por separado de las tareas para
-- dibujar las bandas y agrupar debajo de cada una.
CREATE INDEX IF NOT EXISTS idx_team_tasks_stage ON team_tasks(client_id, is_stage, due_date);
