/**
 * Cliente mínimo de la API de Notion (sin SDK, sólo fetch) para el tablero de
 * tareas del equipo.
 *
 * Notion es la fuente de verdad: acá se lee la base de datos que el admin
 * conectó, se traduce cada página a la forma que usa el CRM, y se escribe de
 * vuelta el estado cuando alguien marca una tarea como hecha.
 *
 * La versión de la API queda fijada en 2022-06-28 a propósito: las versiones
 * nuevas reemplazan "database" por "data source" y cambian la forma de las
 * consultas, así que subirla no es un detalle cosmético.
 */

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export class NotionError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'NotionError'
  }
}

function token(): string {
  const t = process.env.NOTION_TOKEN
  if (!t) throw new NotionError('Falta NOTION_TOKEN en las variables de entorno')
  return t
}

async function notionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    // El 404 casi siempre es lo mismo: la base existe pero nadie la compartió
    // con la integración. Vale la pena decirlo en vez de "not found".
    if (res.status === 404) {
      throw new NotionError(
        'Notion no encuentra esa base de datos. Ábrela en Notion → menú ••• → Conexiones → agrega tu integración, e inténtalo de nuevo.',
        404
      )
    }
    if (res.status === 401) {
      throw new NotionError('El token de Notion no es válido o fue revocado.', 401)
    }
    throw new NotionError(`Error de Notion (${res.status}): ${body.slice(0, 300)}`, res.status)
  }

  return res.json() as Promise<T>
}

/**
 * Saca el id de 32 caracteres de un link de Notion. Acepta el link completo
 * de la base ("…/Tareas-1f2a…?v=…"), el link corto (notion.so/1f2a…) o el id
 * pelado, con o sin guiones.
 */
export function extractDatabaseId(input: string): string | null {
  const withoutQuery = input.split('?')[0]
  const matches = withoutQuery.match(/[0-9a-fA-F]{32}/g)
  if (matches?.length) return matches[matches.length - 1].toLowerCase()

  const dashed = withoutQuery.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  if (dashed) return dashed[0].replace(/-/g, '').toLowerCase()

  return null
}

// ── Esquema y mapeo de propiedades ────────────────────────────────────────────

interface NotionPropertySchema {
  id: string
  name: string
  type: string
  select?: { options: { id: string; name: string; color: string }[] }
  multi_select?: { options: { id: string; name: string }[] }
  status?: {
    options: { id: string; name: string }[]
    groups: { id: string; name: string; option_ids: string[] }[]
  }
}

interface NotionDatabase {
  id: string
  url: string
  title: { plain_text: string }[]
  properties: Record<string, NotionPropertySchema>
}

/** Qué propiedad de la base de Notion es cada campo del CRM. */
export interface NotionTaskMap {
  databaseTitle: string
  databaseUrl: string
  title: string
  status: string | null
  statusType: 'status' | 'select' | 'checkbox' | null
  /** Nombre exacto de la opción de Notion que significa cada estado. */
  doneValue: string | null
  pendingValue: string | null
  progressValue: string | null
  /** option_id → 'pendiente' | 'en_progreso' | 'hecha' */
  statusValueMap: Record<string, string>
  assignee: string | null
  assigneeType: 'people' | 'select' | 'multi_select' | 'rich_text' | null
  date: string | null
  priority: string | null
  group: string | null
  /** Propiedad que distingue etapa de tarea. null si la base no la tiene. */
  kind: string | null
  /** Propiedad de texto donde escribir la nota de cierre, si existe. */
  note: string | null
  /** Opciones que ya existen en Notion, para los desplegables del CRM.
   *  Escribir un valor que no está en esta lista hace que Notion cree una
   *  opción nueva — que es justo lo que pasa con "Fabián" vs "Fabian". */
  assigneeOptions: string[]
  priorityOptions: string[]
  groupOptions: string[]
  statusOptions: string[]
}

const DONE_RE = /hech|listo|done|complet|termin|finaliz|cerrad/i
const PROGRESS_RE = /progres|curso|haciendo|doing|proceso|activ|empez/i
const ASSIGNEE_RE = /responsab|asignad|encargad|owner|assignee|persona|quien/i
const DATE_RE = /fecha|date|vencim|due|entrega|deadline|plazo/i
const PRIORITY_RE = /prioridad|priority|urgenc/i
const GROUP_RE = /fase|etapa|categor|grupo|area|área|bloque|semana|seccion|sección/i
const NOTE_RE = /nota|coment|avance|feedback|observ/i
const STATUS_RE = /estado|status|situacion|situación/i

// Marca qué filas son etapas y no tareas. Se exige que el nombre EMPIECE por
// "tipo"/"type" y no hay fallback al primer select disponible: si esta
// propiedad se detectara mal, media base pasaría a ser etapa de golpe.
const KIND_RE = /^(tipo|type)/i
const STAGE_VALUE_RE = /etapa|fase|stage|phase|per[ií]odo|bloque/i

function findProp(
  props: Record<string, NotionPropertySchema>,
  types: string[],
  nameRe?: RegExp
): NotionPropertySchema | null {
  const candidates = Object.values(props).filter((p) => types.includes(p.type))
  if (nameRe) {
    const named = candidates.find((p) => nameRe.test(p.name))
    if (named) return named
  }
  return candidates[0] ?? null
}

/**
 * Detecta el mapeo mirando tipo + nombre de cada propiedad, para que conectar
 * la base funcione sin que nadie configure nada a mano. Si algo queda mal
 * detectado, el mapeo se guarda en clients.notion_tasks_map y se puede
 * corregir ahí sin tocar código.
 */
export function detectTaskMap(db: NotionDatabase): NotionTaskMap {
  const props = db.properties

  const titleProp = Object.values(props).find((p) => p.type === 'title')
  const statusProp =
    findProp(props, ['status'], STATUS_RE) ??
    findProp(props, ['select'], STATUS_RE) ??
    findProp(props, ['checkbox'], /hecho|complet|listo|done|ok/i)

  const assigneeProp =
    Object.values(props).find((p) => ASSIGNEE_RE.test(p.name) && ['people', 'select', 'multi_select', 'rich_text'].includes(p.type)) ??
    findProp(props, ['people'])

  const dateProp = findProp(props, ['date'], DATE_RE)
  const priorityProp = Object.values(props).find((p) => PRIORITY_RE.test(p.name) && ['select', 'status'].includes(p.type))
  const groupProp = Object.values(props).find((p) => GROUP_RE.test(p.name) && ['select', 'multi_select'].includes(p.type))
  const noteProp = Object.values(props).find((p) => NOTE_RE.test(p.name) && p.type === 'rich_text')
  const kindProp = Object.values(props).find((p) => KIND_RE.test(p.name) && ['select', 'multi_select', 'status'].includes(p.type))

  const statusValueMap: Record<string, string> = {}
  let doneValue: string | null = null
  let pendingValue: string | null = null
  let progressValue: string | null = null

  if (statusProp?.type === 'status' && statusProp.status) {
    // Las propiedades "status" de Notion ya vienen agrupadas en
    // To-do / In progress / Complete. Usar el grupo es más confiable que
    // adivinar por el nombre de la opción, que cada uno escribe distinto.
    const groupOf = new Map<string, string>()
    for (const g of statusProp.status.groups) {
      for (const optionId of g.option_ids) groupOf.set(optionId, g.name.toLowerCase())
    }
    for (const opt of statusProp.status.options) {
      const g = groupOf.get(opt.id) ?? ''
      const bucket = /complete|done|listo|termin/i.test(g)
        ? 'hecha'
        : /progress|curso|proceso/i.test(g)
          ? 'en_progreso'
          : DONE_RE.test(opt.name)
            ? 'hecha'
            : PROGRESS_RE.test(opt.name)
              ? 'en_progreso'
              : 'pendiente'
      statusValueMap[opt.id] = bucket
      if (bucket === 'hecha' && !doneValue) doneValue = opt.name
      if (bucket === 'en_progreso' && !progressValue) progressValue = opt.name
      if (bucket === 'pendiente' && !pendingValue) pendingValue = opt.name
    }
  } else if (statusProp?.type === 'select' && statusProp.select) {
    for (const opt of statusProp.select.options) {
      const bucket = DONE_RE.test(opt.name) ? 'hecha' : PROGRESS_RE.test(opt.name) ? 'en_progreso' : 'pendiente'
      statusValueMap[opt.id] = bucket
      if (bucket === 'hecha' && !doneValue) doneValue = opt.name
      if (bucket === 'en_progreso' && !progressValue) progressValue = opt.name
      if (bucket === 'pendiente' && !pendingValue) pendingValue = opt.name
    }
  }

  function optionsOf(prop: NotionPropertySchema | null | undefined): string[] {
    if (!prop) return []
    if (prop.type === 'status') return prop.status?.options.map((o) => o.name) ?? []
    if (prop.type === 'select') return prop.select?.options.map((o) => o.name) ?? []
    if (prop.type === 'multi_select') return prop.multi_select?.options.map((o) => o.name) ?? []
    return []
  }

  return {
    databaseTitle: db.title?.map((t) => t.plain_text).join('') || 'Tareas',
    databaseUrl: db.url,
    title: titleProp?.name ?? 'Name',
    status: statusProp?.name ?? null,
    statusType: (statusProp?.type as NotionTaskMap['statusType']) ?? null,
    doneValue,
    pendingValue,
    progressValue,
    statusValueMap,
    assignee: assigneeProp?.name ?? null,
    assigneeType: (assigneeProp?.type as NotionTaskMap['assigneeType']) ?? null,
    date: dateProp?.name ?? null,
    priority: priorityProp?.name ?? null,
    group: groupProp?.name ?? null,
    kind: kindProp?.name ?? null,
    note: noteProp?.name ?? null,
    assigneeOptions: optionsOf(assigneeProp),
    priorityOptions: optionsOf(priorityProp),
    groupOptions: optionsOf(groupProp),
    statusOptions: optionsOf(statusProp),
  }
}

export async function getDatabase(databaseId: string): Promise<NotionDatabase> {
  return notionFetch<NotionDatabase>(`/databases/${databaseId}`)
}

/** Conecta una base: valida el acceso y devuelve el mapeo detectado. */
export async function connectDatabase(urlOrId: string): Promise<{ databaseId: string; map: NotionTaskMap }> {
  const databaseId = extractDatabaseId(urlOrId)
  if (!databaseId) throw new NotionError('Ese link no parece de una base de datos de Notion.')

  const db = await getDatabase(databaseId)
  const map = detectTaskMap(db)
  if (!map.status) {
    throw new NotionError(
      'Esa base no tiene una propiedad de estado. Agrégale una propiedad tipo "Estado" (Status) o una casilla "Hecho" y vuelve a conectar.'
    )
  }
  return { databaseId, map }
}

// ── Lectura de páginas ────────────────────────────────────────────────────────

interface NotionRichText {
  plain_text: string
  href: string | null
}

interface NotionPageProperty {
  type: string
  title?: NotionRichText[]
  rich_text?: NotionRichText[]
  select?: { id: string; name: string } | null
  status?: { id: string; name: string } | null
  multi_select?: { id: string; name: string }[]
  people?: { id: string; name?: string; person?: { email?: string } }[]
  date?: { start: string | null; end: string | null } | null
  checkbox?: boolean
}

interface NotionPage {
  id: string
  url: string
  archived: boolean
  in_trash?: boolean
  last_edited_time: string
  properties: Record<string, NotionPageProperty>
}

export interface NotionTask {
  notion_page_id: string
  notion_url: string
  title: string
  status: 'pendiente' | 'en_progreso' | 'hecha'
  status_raw: string | null
  priority: 'baja' | 'media' | 'alta' | null
  due_date: string | null
  /** Fin del rango en Notion. NULL si la tarea ocupa un solo día. */
  end_date: string | null
  /** true cuando la fila es una etapa del lanzamiento, no una tarea. */
  is_stage: boolean
  assignee_name: string | null
  assignee_email: string | null
  group_name: string | null
  notion_last_edited: string
}

function plain(rt?: NotionRichText[] | null): string {
  return (rt ?? []).map((t) => t.plain_text).join('').trim()
}

function readAssignee(prop: NotionPageProperty | undefined): { name: string | null; email: string | null } {
  if (!prop) return { name: null, email: null }
  switch (prop.type) {
    case 'people': {
      const p = prop.people?.[0]
      return { name: p?.name ?? null, email: p?.person?.email ?? null }
    }
    case 'select':
      return { name: prop.select?.name ?? null, email: null }
    case 'multi_select':
      return { name: prop.multi_select?.[0]?.name ?? null, email: null }
    case 'rich_text':
      return { name: plain(prop.rich_text) || null, email: null }
    default:
      return { name: null, email: null }
  }
}

function readStatus(prop: NotionPageProperty | undefined, map: NotionTaskMap): { status: NotionTask['status']; raw: string | null } {
  if (!prop) return { status: 'pendiente', raw: null }
  if (prop.type === 'checkbox') return { status: prop.checkbox ? 'hecha' : 'pendiente', raw: null }

  const value = prop.type === 'status' ? prop.status : prop.select
  if (!value) return { status: 'pendiente', raw: null }

  const mapped = map.statusValueMap[value.id]
  const status = (mapped as NotionTask['status']) ?? (DONE_RE.test(value.name) ? 'hecha' : PROGRESS_RE.test(value.name) ? 'en_progreso' : 'pendiente')
  return { status, raw: value.name }
}

function readPriority(prop: NotionPageProperty | undefined): NotionTask['priority'] {
  if (!prop) return null
  const name = prop.type === 'status' ? prop.status?.name : prop.select?.name
  if (!name) return null
  if (/alta|high|urgen|p1|🔴/i.test(name)) return 'alta'
  if (/baja|low|p3|🟢/i.test(name)) return 'baja'
  return 'media'
}

/** Trae todas las páginas de la base (paginado de a 100) y las traduce. */
export async function fetchTasks(databaseId: string, map: NotionTaskMap): Promise<NotionTask[]> {
  const tasks: NotionTask[] = []
  let cursor: string | undefined

  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor

    const res = await notionFetch<{ results: NotionPage[]; next_cursor: string | null; has_more: boolean }>(
      `/databases/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    for (const page of res.results) {
      if (page.archived || page.in_trash) continue

      const title = plain(page.properties[map.title]?.title) || 'Sin título'
      const { status, raw } = readStatus(map.status ? page.properties[map.status] : undefined, map)
      const assignee = readAssignee(map.assignee ? page.properties[map.assignee] : undefined)
      const dateProp = map.date ? page.properties[map.date] : undefined
      const groupProp = map.group ? page.properties[map.group] : undefined
      const kindProp = map.kind ? page.properties[map.kind] : undefined
      const kindValue =
        kindProp?.select?.name ?? kindProp?.status?.name ?? kindProp?.multi_select?.[0]?.name ?? null

      tasks.push({
        notion_page_id: page.id,
        notion_url: page.url,
        title,
        status,
        status_raw: raw,
        priority: readPriority(map.priority ? page.properties[map.priority] : undefined),
        due_date: dateProp?.date?.start ? dateProp.date.start.slice(0, 10) : null,
        // Notion devuelve `end` sólo cuando la fecha es un rango. Descartarlo
        // era lo que hacía que una etapa de seis días llegara como un día suelto.
        end_date: dateProp?.date?.end ? dateProp.date.end.slice(0, 10) : null,
        assignee_name: assignee.name,
        assignee_email: assignee.email,
        group_name: groupProp?.select?.name ?? groupProp?.multi_select?.[0]?.name ?? null,
        is_stage: !!kindValue && STAGE_VALUE_RE.test(kindValue),
        notion_last_edited: page.last_edited_time,
      })
    }

    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined
  } while (cursor)

  return tasks
}

// ── Escritura ─────────────────────────────────────────────────────────────────

/** Campos que el CRM puede escribir en una tarea de Notion. */
export interface NotionTaskFields {
  title?: string
  status?: 'pendiente' | 'en_progreso' | 'hecha'
  assignee?: string | null
  due_date?: string | null
  end_date?: string | null
  priority?: string | null
  group?: string | null
  note?: string | null
}

function richText(content: string) {
  return [{ type: 'text', text: { content: content.slice(0, 1900) } }]
}

/**
 * Traduce los campos del CRM al formato de propiedades de Notion, usando el
 * mapeo detectado. Lo que la base no tenga (por ejemplo, ninguna propiedad de
 * fase) simplemente no se escribe, en vez de romper.
 */
function buildProperties(map: NotionTaskMap, fields: NotionTaskFields): Record<string, unknown> {
  const props: Record<string, unknown> = {}

  if (fields.title !== undefined) {
    props[map.title] = { title: richText(fields.title) }
  }

  if (fields.status !== undefined && map.status && map.statusType) {
    if (map.statusType === 'checkbox') {
      props[map.status] = { checkbox: fields.status === 'hecha' }
    } else {
      const value =
        fields.status === 'hecha' ? map.doneValue : fields.status === 'en_progreso' ? map.progressValue : map.pendingValue
      if (value) props[map.status] = map.statusType === 'status' ? { status: { name: value } } : { select: { name: value } }
    }
  }

  if (fields.assignee !== undefined && map.assignee) {
    // La propiedad "Persona" de Notion se escribe con ids de usuario del
    // workspace, no con nombres — y el equipo de Martín no tiene cuenta ahí.
    // En ese caso el responsable se sigue administrando desde Notion.
    if (map.assigneeType === 'select') {
      props[map.assignee] = { select: fields.assignee ? { name: fields.assignee } : null }
    } else if (map.assigneeType === 'multi_select') {
      props[map.assignee] = { multi_select: fields.assignee ? [{ name: fields.assignee }] : [] }
    } else if (map.assigneeType === 'rich_text') {
      props[map.assignee] = { rich_text: fields.assignee ? richText(fields.assignee) : [] }
    }
  }

  // Escribir sólo `start` borraba el `end` en Notion: editar la fecha de una
  // etapa desde el CRM le colapsaba el rango a un día. Se manda el rango entero.
  if ((fields.due_date !== undefined || fields.end_date !== undefined) && map.date) {
    props[map.date] = {
      date: fields.due_date
        ? { start: fields.due_date, ...(fields.end_date ? { end: fields.end_date } : {}) }
        : null,
    }
  }

  if (fields.priority !== undefined && map.priority) {
    props[map.priority] = { select: fields.priority ? { name: fields.priority } : null }
  }

  if (fields.group !== undefined && map.group) {
    props[map.group] = { select: fields.group ? { name: fields.group } : null }
  }

  if (fields.note !== undefined && map.note) {
    props[map.note] = { rich_text: fields.note ? richText(fields.note) : [] }
  }

  return props
}

/** Crea la tarea en Notion. Devuelve la página nueva para espejarla al toque. */
export async function createTask(
  databaseId: string,
  map: NotionTaskMap,
  fields: NotionTaskFields
): Promise<{ id: string; url: string }> {
  const page = await notionFetch<{ id: string; url: string }>('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildProperties(map, { status: 'pendiente', ...fields }),
    }),
  })
  return { id: page.id, url: page.url }
}

/** Edita una tarea existente. Sólo toca las propiedades que vengan en fields. */
export async function updateTask(pageId: string, map: NotionTaskMap, fields: NotionTaskFields): Promise<void> {
  const properties = buildProperties(map, fields)
  if (Object.keys(properties).length === 0) return
  await notionFetch(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) })
}

/**
 * Borrar desde el CRM archiva en Notion en vez de destruir: la página queda en
 * la papelera y se puede recuperar, cosa que un borrado real no permite.
 */
export async function archiveTask(pageId: string): Promise<void> {
  await notionFetch(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
}

// ── Bloques (el contenido de la tarea) ────────────────────────────────────────

export async function setTodoChecked(blockId: string, checked: boolean): Promise<void> {
  await notionFetch(`/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify({ to_do: { checked } }) })
}

export async function appendBlock(pageId: string, text: string, kind: 'texto' | 'checklist'): Promise<void> {
  const child =
    kind === 'checklist'
      ? { object: 'block', type: 'to_do', to_do: { rich_text: richText(text), checked: false } }
      : { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } }

  await notionFetch(`/blocks/${pageId}/children`, { method: 'PATCH', body: JSON.stringify({ children: [child] }) })
}

export async function deleteBlock(blockId: string): Promise<void> {
  await notionFetch(`/blocks/${blockId}`, { method: 'DELETE' })
}

// ── Contenido de una página (para el panel de detalle) ────────────────────────

export interface NotionBlock {
  id: string
  type: 'texto' | 'titulo' | 'vineta' | 'numerada' | 'checklist' | 'cita' | 'codigo' | 'imagen' | 'divisor'
  text: string
  checked?: boolean
  url?: string
}

interface RawBlock {
  id: string
  type: string
  has_children: boolean
  [key: string]: unknown
}

const BLOCK_KIND: Record<string, NotionBlock['type']> = {
  paragraph: 'texto',
  heading_1: 'titulo',
  heading_2: 'titulo',
  heading_3: 'titulo',
  bulleted_list_item: 'vineta',
  numbered_list_item: 'numerada',
  to_do: 'checklist',
  quote: 'cita',
  callout: 'cita',
  code: 'codigo',
  toggle: 'texto',
  divider: 'divisor',
}

/**
 * Lee el contenido de una tarea de Notion para mostrarlo dentro del CRM (sólo
 * lectura). Sólo el primer nivel: para el detalle completo está el link a
 * Notion, y bajar el árbol entero serían N llamadas por tarea.
 */
export async function fetchPageContent(pageId: string): Promise<NotionBlock[]> {
  const res = await notionFetch<{ results: RawBlock[] }>(`/blocks/${pageId}/children?page_size=100`)

  const blocks: NotionBlock[] = []
  for (const raw of res.results) {
    if (raw.type === 'image') {
      const image = raw.image as { type: string; file?: { url: string }; external?: { url: string } } | undefined
      const url = image?.file?.url ?? image?.external?.url
      if (url) blocks.push({ id: raw.id, type: 'imagen', text: '', url })
      continue
    }

    const kind = BLOCK_KIND[raw.type]
    if (!kind) continue
    if (kind === 'divisor') {
      blocks.push({ id: raw.id, type: 'divisor', text: '' })
      continue
    }

    const payload = raw[raw.type] as { rich_text?: NotionRichText[]; checked?: boolean } | undefined
    const text = plain(payload?.rich_text)
    if (!text) continue

    blocks.push({
      id: raw.id,
      type: kind,
      text,
      ...(raw.type === 'to_do' ? { checked: payload?.checked ?? false } : {}),
    })
  }

  return blocks
}

// ── Editar las opciones de una propiedad ──────────────────────────────────────

export interface SelectOption {
  /** Sin id = opción nueva. Con id = se renombra la existente. */
  id?: string
  name: string
  color?: string
}

/**
 * Lee las opciones con su id (necesario para renombrar sin perder el vínculo
 * con las tareas) y el tipo de la propiedad, que decide si se puede editar.
 */
export async function getSelectOptions(
  databaseId: string,
  propertyName: string
): Promise<{ type: 'select' | 'multi_select' | null; options: SelectOption[] }> {
  const db = await getDatabase(databaseId)
  const prop = db.properties[propertyName]
  if (!prop) return { type: null, options: [] }
  if (prop.type === 'select') return { type: 'select', options: prop.select?.options ?? [] }
  if (prop.type === 'multi_select') return { type: 'multi_select', options: prop.multi_select?.options ?? [] }
  return { type: null, options: [] }
}

/**
 * Aplica cambios a las opciones de un select en Notion, respetando lo que la
 * API permite de verdad — comprobado contra la API, no asumido:
 *
 *  - Agregar una opción nueva: funciona.
 *  - Borrar una opción (omitirla de la lista): funciona.
 *  - Renombrar una opción existente: la API acepta el pedido y NO lo aplica,
 *    sin devolver error. Por eso acá el renombre se hace en tres pasos: se
 *    crea la opción con el nombre nuevo, se mueven a ella las tareas que
 *    tenían la vieja, y recién ahí se borra la vieja.
 *  - Cambiar el color de una opción existente: devuelve 400. Por eso el color
 *    sólo se manda en opciones nuevas.
 */
export interface SelectOptionPlan {
  /** Ids de las opciones que quedan como están. */
  keepIds: string[]
  /** Opciones nuevas. */
  add: { name: string; color?: string }[]
  /** Renombres: se resuelven creando la nueva y migrando las tareas. */
  renames: { id: string; oldName: string; newName: string; color?: string }[]
}

async function patchOptions(
  databaseId: string,
  propertyName: string,
  propertyType: 'select' | 'multi_select',
  options: ({ id: string } | { name: string; color?: string })[]
): Promise<Record<string, SelectOption>> {
  const db = await notionFetch<NotionDatabase>(`/databases/${databaseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { [propertyName]: { [propertyType]: { options } } } }),
  })

  const prop = db.properties[propertyName]
  const list = propertyType === 'select' ? (prop?.select?.options ?? []) : (prop?.multi_select?.options ?? [])
  return Object.fromEntries(list.map((o) => [o.name, o]))
}

/** Mueve todas las tareas que tienen una opción a otra. */
async function movePagesToOption(
  databaseId: string,
  propertyName: string,
  propertyType: 'select' | 'multi_select',
  fromName: string,
  toName: string
): Promise<void> {
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter:
        propertyType === 'select'
          ? { property: propertyName, select: { equals: fromName } }
          : { property: propertyName, multi_select: { contains: fromName } },
    }
    if (cursor) body.start_cursor = cursor

    const res = await notionFetch<{ results: { id: string }[]; next_cursor: string | null; has_more: boolean }>(
      `/databases/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    for (const page of res.results) {
      await notionFetch(`/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            [propertyName]: propertyType === 'select' ? { select: { name: toName } } : { multi_select: [{ name: toName }] },
          },
        }),
      })
    }

    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined
  } while (cursor)
}

export async function applySelectOptionChanges(
  databaseId: string,
  propertyName: string,
  propertyType: 'select' | 'multi_select',
  plan: SelectOptionPlan
): Promise<void> {
  const keep = plan.keepIds.map((id) => ({ id }))
  const renameOld = plan.renames.map((r) => ({ id: r.id }))
  const nuevas = [
    ...plan.add.map((o) => ({ name: o.name, ...(o.color ? { color: o.color } : {}) })),
    ...plan.renames.map((r) => ({ name: r.newName, ...(r.color ? { color: r.color } : {}) })),
  ]

  // Paso 1: conviven las viejas y las nuevas, para poder mover las tareas.
  const byName = await patchOptions(databaseId, propertyName, propertyType, [...keep, ...renameOld, ...nuevas])

  if (plan.renames.length === 0) return

  // Paso 2: las tareas pasan de la opción vieja a la nueva.
  for (const r of plan.renames) {
    await movePagesToOption(databaseId, propertyName, propertyType, r.oldName, r.newName)
  }

  // Paso 3: se borran las viejas, ya sin tareas colgando de ellas.
  const finalIds = [
    ...plan.keepIds,
    ...plan.add.map((o) => byName[o.name]?.id).filter((id): id is string => !!id),
    ...plan.renames.map((r) => byName[r.newName]?.id).filter((id): id is string => !!id),
  ]
  await patchOptions(databaseId, propertyName, propertyType, finalIds.map((id) => ({ id })))
}
