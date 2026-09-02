'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import {
  connectDatabase,
  getDatabase,
  detectTaskMap,
  fetchTasks,
  fetchPageContent,
  createTask,
  updateTask,
  archiveTask,
  setTodoChecked,
  appendBlock,
  getSelectOptions,
  applySelectOptionChanges,
  NotionError,
  type SelectOption,
  type NotionTaskMap,
  type NotionTaskFields,
  type NotionBlock,
} from '@/lib/services/notion'
import type { TeamTask, TeamTaskStatus } from '@/lib/types'

// Conectar la base de Notion y sincronizar es sólo de admin, igual que la
// pestaña Equipo. El resto del equipo ve su cliente y mueve el estado de LO
// SUYO — nada más.
const BOARD_EDITOR_ROLES = ['admin']

interface Viewer {
  id: string
  role: string
  client_id: string | null
  full_name: string
  email: string
  canEdit: boolean
}

async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, client_id, full_name, email, user_type')
    .eq('id', user.id)
    .single()

  if (!profile || profile.user_type !== 'agency') return null

  return {
    id: user.id,
    role: profile.role,
    client_id: profile.client_id,
    full_name: profile.full_name,
    email: profile.email,
    canEdit: BOARD_EDITOR_ROLES.includes(profile.role),
  }
}

// Un no-admin sólo puede tocar el cliente al que está asignado. Sin esto,
// cualquiera podría leer el tablero de otro negocio pasando otro clientId a
// mano (la RLS sólo distingue agencia vs portal).
function canSeeClient(viewer: Viewer, clientId: string): boolean {
  return viewer.canEdit || viewer.client_id === clientId
}

async function requireEditor(clientId: string): Promise<Viewer> {
  const viewer = await getViewer()
  if (!viewer) throw new Error('No autenticado')
  if (!viewer.canEdit) throw new Error('Solo un admin puede configurar el tablero de tareas')
  if (!canSeeClient(viewer, clientId)) throw new Error('Sin acceso a este cliente')
  return viewer
}

export interface NotionTasksConfig {
  connected: boolean
  /** La migración 036 todavía no corrió contra esta base de datos. */
  needsMigration: boolean
  databaseId: string | null
  databaseTitle: string | null
  databaseUrl: string | null
  syncedAt: string | null
  /** Qué propiedad de Notion quedó mapeada a cada campo, para mostrarlo. */
  detected: { campo: string; propiedad: string }[]
  /** Opciones que existen en Notion, para los desplegables del CRM. */
  options: { assignee: string[]; priority: string[]; group: string[] }
  /** La propiedad "Persona" de Notion no se puede escribir por nombre, así que
   *  en ese caso el responsable sólo se cambia desde Notion. */
  assigneeEditable: boolean
}

export interface TaskBoardData {
  tasks: TeamTask[]
  config: NotionTasksConfig
  viewerId: string
  viewerName: string
  canEdit: boolean
}

// 42703 = columna inexistente, 42P01 = tabla inexistente: es lo que devuelve
// Postgres cuando supabase/036-team-tasks.sql todavía no se corrió. Sin este
// caso especial, la pantalla muere con un error de PostgREST que no le dice
// nada a nadie.
const MISSING_SCHEMA_CODES = ['42703', '42P01']

async function loadConfig(
  clientId: string
): Promise<{ databaseId: string | null; map: NotionTaskMap | null; syncedAt: string | null; needsMigration: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('notion_tasks_db_id, notion_tasks_map, notion_tasks_synced_at')
    .eq('id', clientId)
    .single()

  return {
    databaseId: data?.notion_tasks_db_id ?? null,
    map: (data?.notion_tasks_map as NotionTaskMap | null) ?? null,
    syncedAt: data?.notion_tasks_synced_at ?? null,
    needsMigration: MISSING_SCHEMA_CODES.includes(error?.code ?? ''),
  }
}

function describeMap(map: NotionTaskMap | null): { campo: string; propiedad: string }[] {
  if (!map) return []
  return [
    { campo: 'Tarea', propiedad: map.title },
    { campo: 'Estado', propiedad: map.status ?? '— sin detectar —' },
    { campo: 'Responsable', propiedad: map.assignee ?? '— sin detectar —' },
    { campo: 'Fecha', propiedad: map.date ?? '— sin detectar —' },
    { campo: 'Prioridad', propiedad: map.priority ?? '— sin detectar —' },
    { campo: 'Fase / grupo', propiedad: map.group ?? '— sin detectar —' },
    { campo: 'Nota de cierre', propiedad: map.note ?? '— sólo se guarda en el CRM —' },
  ]
}

export async function getTaskBoard(clientId: string): Promise<TaskBoardData> {
  const viewer = await getViewer()
  if (!viewer) throw new Error('No autenticado')
  if (!canSeeClient(viewer, clientId)) throw new Error('Sin acceso a este cliente')

  const supabase = await createClient()
  const [{ data: tasks }, config] = await Promise.all([
    supabase
      .from('team_tasks')
      .select('*')
      .eq('client_id', clientId)
      .order('due_date', { ascending: true, nullsFirst: false }),
    loadConfig(clientId),
  ])

  return {
    tasks: (tasks ?? []) as TeamTask[],
    config: {
      connected: !!config.databaseId,
      needsMigration: config.needsMigration,
      databaseId: config.databaseId,
      databaseTitle: config.map?.databaseTitle ?? null,
      databaseUrl: config.map?.databaseUrl ?? null,
      syncedAt: config.syncedAt,
      detected: describeMap(config.map),
      options: {
        assignee: config.map?.assigneeOptions ?? [],
        priority: config.map?.priorityOptions ?? [],
        group: config.map?.groupOptions ?? [],
      },
      assigneeEditable: !!config.map?.assignee && config.map.assigneeType !== 'people',
    },
    viewerId: viewer.id,
    viewerName: viewer.full_name,
    canEdit: viewer.canEdit,
  }
}

/** Contador para el badge de la sub-pestaña Tareas del CRM. */
export async function getPendingTaskCount(clientId: string): Promise<number> {
  const viewer = await getViewer()
  if (!viewer || !canSeeClient(viewer, clientId)) return 0

  const supabase = await createClient()
  let query = supabase
    .from('team_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .neq('status', 'hecha')

  // El admin ve el total del cliente; cada miembro ve sólo lo suyo, que es lo
  // que tiene que empujarlo a entrar.
  if (!viewer.canEdit) query = query.eq('assigned_to', viewer.id)

  const { count, error } = await query
  if (error) return 0
  return count ?? 0
}

// ── Conexión con Notion ───────────────────────────────────────────────────────

export async function connectNotionAction(
  clientId: string,
  urlOrId: string
): Promise<{ success: true; synced: number } | { success: false; error: string }> {
  try {
    await requireEditor(clientId)
    const { databaseId, map } = await connectDatabase(urlOrId)

    const supabase = await createClient()
    const { error } = await supabase
      .from('clients')
      .update({ notion_tasks_db_id: databaseId, notion_tasks_map: map })
      .eq('id', clientId)
    if (error) return { success: false, error: error.message }

    const result = await syncNotionTasksAction(clientId)
    if (!result.success) return result
    return { success: true, synced: result.synced }
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

export async function disconnectNotionAction(clientId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireEditor(clientId)
    const supabase = await createClient()
    // Se borra el espejo también: dejar tareas huérfanas de una base que ya
    // no se mira sólo confunde al equipo.
    await supabase.from('team_tasks').delete().eq('client_id', clientId)
    await supabase
      .from('clients')
      .update({ notion_tasks_db_id: null, notion_tasks_map: null, notion_tasks_synced_at: null })
      .eq('id', clientId)
    revalidatePath(`/clients/${clientId}/tareas`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error inesperado' }
  }
}

// Nombres como "José Pérez" y "jose perez" tienen que matchear: se compara
// sin acentos, sin mayúsculas y sin espacios de más.
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Las notificaciones tienen RLS "user_id = auth.uid()", así que avisarle a
// OTRA persona hay que hacerlo con el cliente admin — con el cliente normal
// el insert se rechaza.
async function notify(userId: string, title: string, body: string, taskId: string) {
  try {
    const admin = createAdminClient()
    await admin.from('notifications').insert({
      user_id: userId,
      title,
      body,
      type: 'assignment',
      severity: 'info',
      reference_type: 'team_task',
      reference_id: taskId,
    })
  } catch (e) {
    // Un aviso que no se pudo insertar no debe tumbar el sync entero.
    console.error('No se pudo crear la notificación de tarea', e)
  }
}

/**
 * Trae todo de Notion y deja el espejo igual: crea, actualiza y borra.
 * Notion manda — lo único que el CRM conserva de lo suyo es la nota de cierre
 * cuando la base de Notion no tiene una propiedad donde escribirla.
 */
export async function syncNotionTasksAction(
  clientId: string
): Promise<{ success: true; synced: number } | { success: false; error: string }> {
  const viewer = await getViewer()
  if (!viewer) return { success: false, error: 'No autenticado' }
  if (!canSeeClient(viewer, clientId)) return { success: false, error: 'Sin acceso a este cliente' }

  const { databaseId, map: storedMap } = await loadConfig(clientId)
  if (!databaseId || !storedMap) return { success: false, error: 'Este cliente todavía no tiene una base de Notion conectada' }

  const supabase = await createClient()

  try {
    // Se vuelve a leer el esquema en cada sync: es una llamada más (~300ms) y
    // evita que agregar una fase o un responsable en Notion deje el
    // desplegable del CRM desactualizado hasta la próxima reconexión.
    const map = await getDatabase(databaseId)
      .then(detectTaskMap)
      .catch(() => storedMap)

    const [notionTasks, { data: existingRows }, { data: users }] = await Promise.all([
      fetchTasks(databaseId, map),
      supabase.from('team_tasks').select('id, notion_page_id, assigned_to, status, completed_at').eq('client_id', clientId),
      // Admins incluidos: pueden ser responsables de tareas de cualquier cliente.
      supabase.from('users').select('id, full_name, email, role, client_id').eq('user_type', 'agency').eq('is_active', true),
    ])

    const candidates = (users ?? []).filter((u) => u.role === 'admin' || u.client_id === clientId)
    const byEmail = new Map(candidates.map((u) => [u.email?.toLowerCase(), u.id]))
    const byName = new Map(candidates.map((u) => [normalizeName(u.full_name ?? ''), u.id]))

    const existing = new Map((existingRows ?? []).map((r) => [r.notion_page_id, r]))
    const now = new Date().toISOString()

    const rows = notionTasks.map((t) => {
      const prev = existing.get(t.notion_page_id)
      const assignedTo =
        (t.assignee_email ? byEmail.get(t.assignee_email.toLowerCase()) : undefined) ??
        (t.assignee_name ? byName.get(normalizeName(t.assignee_name)) : undefined) ??
        null

      return {
        client_id: clientId,
        notion_page_id: t.notion_page_id,
        notion_url: t.notion_url,
        title: t.title,
        status: t.status,
        status_raw: t.status_raw,
        priority: t.priority,
        due_date: t.due_date,
        assignee_name: t.assignee_name,
        assigned_to: assignedTo,
        group_name: t.group_name,
        // No se pisa la fecha de completado que ya tenía: sólo se estampa la
        // primera vez que aparece como hecha.
        completed_at: t.status === 'hecha' ? (prev?.completed_at ?? now) : null,
        notion_last_edited: t.notion_last_edited,
        synced_at: now,
        updated_at: now,
      }
    })

    if (rows.length > 0) {
      const { error } = await supabase.from('team_tasks').upsert(rows, { onConflict: 'client_id,notion_page_id' })
      if (error) return { success: false, error: error.message }
    }

    // Lo que ya no está en Notion (borrado o archivado) se va del espejo.
    const livePageIds = new Set(notionTasks.map((t) => t.notion_page_id))
    const goneIds = (existingRows ?? []).filter((r) => !livePageIds.has(r.notion_page_id)).map((r) => r.id)
    if (goneIds.length > 0) {
      await supabase.from('team_tasks').delete().in('id', goneIds)
    }

    await supabase.from('clients').update({ notion_tasks_synced_at: now, notion_tasks_map: map }).eq('id', clientId)

    // Avisos: sólo cuando la tarea es nueva para esa persona o cambió de
    // responsable. Sin esto, cada sync le volvería a notificar lo mismo.
    const { data: refreshed } = await supabase
      .from('team_tasks')
      .select('id, notion_page_id, title, assigned_to, status')
      .eq('client_id', clientId)
      .neq('status', 'hecha')

    for (const task of refreshed ?? []) {
      if (!task.assigned_to || task.assigned_to === viewer.id) continue
      const prev = existing.get(task.notion_page_id)
      const isNew = !prev || prev.assigned_to !== task.assigned_to
      if (isNew) await notify(task.assigned_to, 'Nueva tarea asignada', task.title, task.id)
    }

    revalidatePath(`/clients/${clientId}/tareas`)
    revalidatePath(`/clients/${clientId}`)
    return { success: true, synced: rows.length }
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

// ── Marcar tareas ─────────────────────────────────────────────────────────────

/**
 * Cambia el estado desde el CRM y lo refleja en Notion. Si la escritura a
 * Notion falla, se revierte lo local: mostrar "hecha" en el CRM cuando en
 * Notion sigue pendiente es peor que el error.
 */
export async function setTaskStatusAction(
  clientId: string,
  taskId: string,
  status: TeamTaskStatus,
  completionNote?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const viewer = await getViewer()
  if (!viewer) return { success: false, error: 'No autenticado' }
  if (!canSeeClient(viewer, clientId)) return { success: false, error: 'Sin acceso a este cliente' }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from('team_tasks')
    .select('id, notion_page_id, title, assigned_to, status, completion_note')
    .eq('id', taskId)
    .eq('client_id', clientId)
    .single()

  if (!task) return { success: false, error: 'La tarea ya no existe' }

  // Cada uno cierra lo suyo; el admin puede cerrar cualquiera.
  if (!viewer.canEdit && task.assigned_to !== viewer.id) {
    return { success: false, error: 'Esta tarea no está asignada a vos' }
  }

  const { map } = await loadConfig(clientId)
  if (!map) return { success: false, error: 'Este cliente no tiene una base de Notion conectada' }

  const note = completionNote?.trim() || null
  const { error } = await supabase
    .from('team_tasks')
    .update({
      status,
      completed_at: status === 'hecha' ? new Date().toISOString() : null,
      completion_note: completionNote === undefined ? task.completion_note : note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('client_id', clientId)

  if (error) return { success: false, error: error.message }

  try {
    await updateTask(task.notion_page_id, map, { status, ...(completionNote === undefined ? {} : { note }) })
  } catch (e) {
    await supabase.from('team_tasks').update({ status: task.status }).eq('id', taskId)
    return {
      success: false,
      error: e instanceof Error ? `No se pudo actualizar Notion: ${e.message}` : 'No se pudo actualizar Notion',
    }
  }

  revalidatePath(`/clients/${clientId}/tareas`)
  revalidatePath(`/clients/${clientId}`)
  return { success: true }
}

/** Contenido de la página de Notion, para el panel de detalle (sólo lectura). */
export async function getTaskContentAction(
  clientId: string,
  taskId: string
): Promise<{ success: true; blocks: NotionBlock[] } | { success: false; error: string }> {
  const viewer = await getViewer()
  if (!viewer) return { success: false, error: 'No autenticado' }
  if (!canSeeClient(viewer, clientId)) return { success: false, error: 'Sin acceso a este cliente' }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from('team_tasks')
    .select('notion_page_id')
    .eq('id', taskId)
    .eq('client_id', clientId)
    .single()

  if (!task) return { success: false, error: 'La tarea ya no existe' }

  try {
    return { success: true, blocks: await fetchPageContent(task.notion_page_id) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'No se pudo leer la página de Notion' }
  }
}

// ── Crear y editar desde el CRM ───────────────────────────────────────────────
// Todo lo que se escribe acá va primero a Notion y después al espejo: si la
// llamada a Notion falla, no queda una tarea fantasma que sólo existe en el CRM.

/** Traduce el nombre del responsable al usuario del CRM que le corresponde. */
async function resolveAssignee(clientId: string, name: string | null | undefined): Promise<string | null> {
  if (!name) return null
  const supabase = await createClient()
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email, role, client_id')
    .eq('user_type', 'agency')
    .eq('is_active', true)

  const candidates = (users ?? []).filter((u) => u.role === 'admin' || u.client_id === clientId)
  const target = normalizeName(name)
  const match =
    candidates.find((u) => u.email?.toLowerCase() === name.toLowerCase()) ??
    candidates.find((u) => normalizeName(u.full_name ?? '') === target)
  return match?.id ?? null
}

export async function createTaskAction(
  clientId: string,
  fields: NotionTaskFields
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireEditor(clientId)
    const { databaseId, map } = await loadConfig(clientId)
    if (!databaseId || !map) return { success: false, error: 'Este cliente no tiene una base de Notion conectada' }

    const title = fields.title?.trim()
    if (!title) return { success: false, error: 'La tarea necesita un título' }

    await createTask(databaseId, map, { ...fields, title })

    // Sincronizar después de crear deja el espejo consistente y, de paso,
    // dispara la notificación a quien quedó como responsable.
    return await syncNotionTasksAction(clientId)
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

export async function updateTaskFieldsAction(
  clientId: string,
  taskId: string,
  fields: NotionTaskFields
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const viewer = await requireEditor(clientId)
    const { map } = await loadConfig(clientId)
    if (!map) return { success: false, error: 'Este cliente no tiene una base de Notion conectada' }

    const supabase = await createClient()
    const { data: task } = await supabase
      .from('team_tasks')
      .select('notion_page_id, assigned_to, title')
      .eq('id', taskId)
      .eq('client_id', clientId)
      .single()
    if (!task) return { success: false, error: 'La tarea ya no existe' }

    if (fields.title !== undefined && !fields.title.trim()) {
      return { success: false, error: 'La tarea necesita un título' }
    }

    await updateTask(task.notion_page_id, map, fields)

    // El espejo se actualiza en el momento en vez de esperar al próximo sync,
    // para que el cambio se vea reflejado apenas se cierra el panel.
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (fields.title !== undefined) updates.title = fields.title.trim()
    if (fields.due_date !== undefined) updates.due_date = fields.due_date || null
    // El espejo sólo acepta baja/media/alta (CHECK de la tabla), pero en Notion
    // la opción puede llamarse "P1" o "🔴 Urgente": se traduce igual que en la
    // lectura, en vez de bajar el nombre a minúsculas y romper el constraint.
    if (fields.priority !== undefined) {
      updates.priority = !fields.priority
        ? null
        : /alta|high|urgen|p1/i.test(fields.priority)
          ? 'alta'
          : /baja|low|p3/i.test(fields.priority)
            ? 'baja'
            : 'media'
    }
    if (fields.group !== undefined) updates.group_name = fields.group || null
    if (fields.assignee !== undefined) {
      updates.assignee_name = fields.assignee || null
      updates.assigned_to = await resolveAssignee(clientId, fields.assignee)
    }

    const { error } = await supabase.from('team_tasks').update(updates).eq('id', taskId).eq('client_id', clientId)
    if (error) return { success: false, error: error.message }

    if (updates.assigned_to && updates.assigned_to !== task.assigned_to && updates.assigned_to !== viewer.id) {
      await notify(updates.assigned_to as string, 'Nueva tarea asignada', (updates.title as string) ?? task.title, taskId)
    }

    revalidatePath(`/clients/${clientId}/tareas`)
    revalidatePath(`/clients/${clientId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

/** Archiva la tarea en Notion (queda en la papelera) y la saca del espejo. */
export async function deleteTaskAction(
  clientId: string,
  taskId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireEditor(clientId)
    const supabase = await createClient()
    const { data: task } = await supabase
      .from('team_tasks')
      .select('notion_page_id')
      .eq('id', taskId)
      .eq('client_id', clientId)
      .single()
    if (!task) return { success: false, error: 'La tarea ya no existe' }

    await archiveTask(task.notion_page_id)
    await supabase.from('team_tasks').delete().eq('id', taskId).eq('client_id', clientId)

    revalidatePath(`/clients/${clientId}/tareas`)
    revalidatePath(`/clients/${clientId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

/** Quien tiene la tarea (o el admin) puede tildar los ítems de su checklist. */
async function requireTaskAccess(clientId: string, taskId: string): Promise<{ pageId: string } | { error: string }> {
  const viewer = await getViewer()
  if (!viewer) return { error: 'No autenticado' }
  if (!canSeeClient(viewer, clientId)) return { error: 'Sin acceso a este cliente' }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from('team_tasks')
    .select('notion_page_id, assigned_to')
    .eq('id', taskId)
    .eq('client_id', clientId)
    .single()

  if (!task) return { error: 'La tarea ya no existe' }
  if (!viewer.canEdit && task.assigned_to !== viewer.id) return { error: 'Esta tarea no está asignada a vos' }
  return { pageId: task.notion_page_id }
}

export async function toggleTaskTodoAction(
  clientId: string,
  taskId: string,
  blockId: string,
  checked: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  const access = await requireTaskAccess(clientId, taskId)
  if ('error' in access) return { success: false, error: access.error }

  try {
    await setTodoChecked(blockId, checked)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'No se pudo actualizar Notion' }
  }
}

export async function appendTaskBlockAction(
  clientId: string,
  taskId: string,
  text: string,
  kind: 'texto' | 'checklist'
): Promise<{ success: true; blocks: NotionBlock[] } | { success: false; error: string }> {
  const access = await requireTaskAccess(clientId, taskId)
  if ('error' in access) return { success: false, error: access.error }
  if (!text.trim()) return { success: false, error: 'Escribí algo primero' }

  try {
    await appendBlock(access.pageId, text.trim(), kind)
    return { success: true, blocks: await fetchPageContent(access.pageId) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'No se pudo escribir en Notion' }
  }
}

// ── Editar las opciones de Fase / Prioridad / Responsable ─────────────────────

export type OptionField = 'group' | 'priority' | 'assignee'

const FIELD_LABEL: Record<OptionField, string> = {
  group: 'Fase',
  priority: 'Prioridad',
  assignee: 'Responsable',
}

export interface FieldOptions {
  propertyName: string
  editable: boolean
  options: SelectOption[]
  /** Por qué no se puede editar, cuando corresponde. */
  reason?: string
}

export async function getFieldOptionsAction(
  clientId: string,
  field: OptionField
): Promise<{ success: true; data: FieldOptions } | { success: false; error: string }> {
  try {
    await requireEditor(clientId)
    const { databaseId, map } = await loadConfig(clientId)
    if (!databaseId || !map) return { success: false, error: 'Este cliente no tiene una base de Notion conectada' }

    const propertyName = map[field]
    if (!propertyName) {
      return {
        success: true,
        data: {
          propertyName: '',
          editable: false,
          options: [],
          reason: `Tu base de Notion no tiene una propiedad de ${FIELD_LABEL[field]}. Creala en Notion y sincronizá.`,
        },
      }
    }

    const { type, options } = await getSelectOptions(databaseId, propertyName)
    return {
      success: true,
      data: {
        propertyName,
        editable: type !== null,
        options,
        // Notion no deja tocar por API las propiedades tipo "Status", sólo las
        // de tipo Select. Es limitación de ellos, no del CRM.
        reason: type === null ? `"${propertyName}" no es una propiedad tipo Select, así que Notion no permite editarla desde afuera.` : undefined,
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}

/**
 * Guarda las opciones de la propiedad. Compara contra lo que hay hoy en Notion
 * y arma el plan de cambios: qué queda igual, qué se agrega, qué se renombra
 * (con migración de tareas) y qué se borra.
 */
export async function saveFieldOptionsAction(
  clientId: string,
  field: OptionField,
  rows: { id?: string; name: string; color?: string }[]
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireEditor(clientId)
    const { databaseId, map } = await loadConfig(clientId)
    if (!databaseId || !map) return { success: false, error: 'Este cliente no tiene una base de Notion conectada' }

    const propertyName = map[field]
    if (!propertyName) return { success: false, error: `Tu base de Notion no tiene una propiedad de ${FIELD_LABEL[field]}` }

    const { type, options: current } = await getSelectOptions(databaseId, propertyName)
    if (!type) return { success: false, error: `"${propertyName}" no es una propiedad tipo Select y Notion no permite editarla por API` }

    const clean = rows.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name)
    const names = clean.map((r) => r.name.toLowerCase())
    if (new Set(names).size !== names.length) return { success: false, error: 'Hay dos opciones con el mismo nombre' }

    const currentById = new Map(current.filter((o) => o.id).map((o) => [o.id as string, o]))

    const keepIds: string[] = []
    const add: { name: string; color?: string }[] = []
    const renames: { id: string; oldName: string; newName: string; color?: string }[] = []

    for (const row of clean) {
      const existing = row.id ? currentById.get(row.id) : undefined
      if (!existing) {
        add.push({ name: row.name, color: row.color })
      } else if (existing.name === row.name) {
        keepIds.push(existing.id as string)
      } else {
        renames.push({ id: existing.id as string, oldName: existing.name, newName: row.name, color: row.color })
      }
    }

    await applySelectOptionChanges(databaseId, propertyName, type, { keepIds, add, renames })

    // Re-sincronizar deja el espejo con los nombres nuevos y refresca los
    // desplegables del CRM en el mismo movimiento.
    return await syncNotionTasksAction(clientId)
  } catch (e) {
    return { success: false, error: e instanceof NotionError || e instanceof Error ? e.message : 'Error inesperado' }
  }
}
