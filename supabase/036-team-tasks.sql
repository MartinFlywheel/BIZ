-- =====================================================
-- Tareas del equipo — espejo de una base de datos de Notion
-- =====================================================
-- Martín planifica en Notion (calendario, vistas, subpáginas: todo lo que
-- Notion hace bien) y el CRM refleja esas tareas para que cada miembro del
-- equipo vea SUS pendientes sin entrar a Notion ni tener cuenta.
--
-- Notion es la fuente de verdad: cada sync sobrescribe lo local. La única
-- escritura que sale del CRM es el estado de la tarea (marcar hecha), que se
-- manda de vuelta a la página de Notion en el mismo momento — ver
-- src/lib/services/notion.ts y src/lib/actions/tasks.ts.

-- Configuración por cliente: qué base de datos de Notion mirar y qué
-- propiedad de esa base es cada campo (detectado automáticamente al
-- conectar, guardado para no re-detectar en cada sync).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notion_tasks_db_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notion_tasks_map JSONB;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notion_tasks_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS team_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

  -- Identidad de la página en Notion. Es la clave del upsert: si la página
  -- se borra o se archiva allá, la fila local se borra en el próximo sync.
  notion_page_id TEXT NOT NULL,
  notion_url TEXT,

  title TEXT NOT NULL,
  status TEXT CHECK (status IN ('pendiente', 'en_progreso', 'hecha')) NOT NULL DEFAULT 'pendiente',
  -- El valor tal cual figura en Notion ("Listo", "En curso"…), para poder
  -- escribir de vuelta exactamente la opción que existe en esa base.
  status_raw TEXT,
  priority TEXT CHECK (priority IN ('baja', 'media', 'alta')),
  due_date DATE,

  -- Responsable como texto (lo que dice Notion) + el usuario del CRM al que
  -- se pudo resolver por email o por nombre. Si no matchea, el nombre igual
  -- se muestra: nunca se pierde información por un mapeo fallido.
  assignee_name TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Agrupador opcional de Notion (fase del lanzamiento, categoría, etc.).
  group_name TEXT,

  completed_at TIMESTAMPTZ,
  -- Lo que el miembro escribe al cerrar la tarea desde el CRM.
  completion_note TEXT,

  notion_last_edited TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Una página de Notion = una fila por cliente. Es el ON CONFLICT del sync.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_tasks_notion_page ON team_tasks(client_id, notion_page_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_assignee ON team_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_team_tasks_due ON team_tasks(client_id, due_date);

ALTER TABLE team_tasks ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que leads/team_assignments: sólo gente de la agencia. El
-- recorte por cliente y por rol lo hace la capa de server actions
-- (src/lib/actions/tasks.ts). Los usuarios del portal de clientes no ven nada.
DROP POLICY IF EXISTS "agency_full_access" ON team_tasks;
CREATE POLICY "agency_full_access" ON team_tasks FOR ALL USING (get_user_type() = 'agency');
