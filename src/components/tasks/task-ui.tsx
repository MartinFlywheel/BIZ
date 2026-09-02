'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, ExternalLink, X, CalendarDays, User, Flag, Layers, Trash2, Plus, ListChecks, Type } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  setTaskStatusAction,
  getTaskContentAction,
  updateTaskFieldsAction,
  deleteTaskAction,
  toggleTaskTodoAction,
  appendTaskBlockAction,
} from '@/lib/actions/tasks'
import type { NotionBlock } from '@/lib/services/notion'
import type { TeamTask, TeamTaskPriority } from '@/lib/types'
import { cn } from '@/lib/utils'

// ── Fechas ────────────────────────────────────────────────────────────────────

/**
 * due_date viene como 'YYYY-MM-DD'. new Date('2026-09-01') lo interpreta como
 * medianoche UTC, que en América muestra el día anterior — por eso se arma a
 * mano con los componentes locales.
 */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Días de diferencia contra hoy: negativo = vencida. */
export function daysFromToday(iso: string): number {
  const today = parseDay(todayISO())
  return Math.round((parseDay(iso).getTime() - today.getTime()) / 86_400_000)
}

export function formatDue(iso: string): string {
  const diff = daysFromToday(iso)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  if (diff === -1) return 'Ayer'
  if (diff < -1) return `Hace ${Math.abs(diff)} días`
  const date = parseDay(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) })
}

/**
 * Una tarea con rango vence al FINAL del rango, no al principio: la etapa del
 * 22 al 27 no está atrasada el día 25, está en curso. Por eso se mira end_date
 * cuando existe y se cae a due_date para las tareas de un solo día.
 */
export function isOverdue(task: TeamTask): boolean {
  const limite = task.end_date ?? task.due_date
  return !!limite && task.status !== 'hecha' && daysFromToday(limite) < 0
}

// ── Urgencia ──────────────────────────────────────────────────────────────────
// La importancia real de una tarea no es solo la prioridad que alguien marcó en
// Notion: una tarea sube de nivel sola a medida que su fecha se acerca. Como
// Martín calendariza todo, la fecha es la señal más fresca y la prioridad es
// una anotación que puede quedar vieja.
//
// Esto se calcula al renderizar y NO se escribe nunca de vuelta: `priority`
// sigue siendo exactamente lo que dice Notion, que es la fuente de verdad.

export type Urgencia = 'vencida' | 'activa' | 'manana' | 'semana' | 'futura' | 'sin_fecha'

/**
 * "activa" cubre tanto la tarea de hoy como la etapa de varios días que ya
 * empezó y todavía no termina: en ambos casos es lo que hay que estar
 * haciendo ahora.
 */
export function urgenciaDe(task: TeamTask): Urgencia {
  if (task.status === 'hecha' || !task.due_date) return 'sin_fecha'
  const inicio = daysFromToday(task.due_date)
  const fin = daysFromToday(task.end_date ?? task.due_date)
  if (fin < 0) return 'vencida'
  if (inicio <= 0) return 'activa'
  if (inicio === 1) return 'manana'
  if (inicio <= 7) return 'semana'
  return 'futura'
}

const URGENCIA_BASE: Record<Urgencia, number> = {
  vencida: 0,
  activa: 100,
  manana: 200,
  semana: 300,
  futura: 500,
  sin_fecha: 700,
}

// Una prioridad alta adelanta un tramo entero (120 > 100 de separación), así
// que "alta para mañana" pasa delante de "baja para hoy". Dos tramos no, a
// propósito: nada marcado como alta para dentro de un mes debería tapar lo de
// hoy, que es justo el problema que se quiere evitar.
const PRIORITY_BOOST: Record<TeamTaskPriority, number> = { alta: 120, media: 40, baja: 0 }

// Sin prioridad se trata como media, no como baja: en Notion la mayoría de las
// tareas no la tienen puesta, y "sin marcar" no significa "no importa".
const SIN_PRIORIDAD = 40

export function urgencyScore(task: TeamTask): number {
  if (task.status === 'hecha') return 9000
  const boost = task.priority ? PRIORITY_BOOST[task.priority] : SIN_PRIORIDAD
  return URGENCIA_BASE[urgenciaDe(task)] - boost
}

/** Orden por urgencia efectiva. Menor score = más arriba. */
export function byUrgency(a: TeamTask, b: TeamTask): number {
  const d = urgencyScore(a) - urgencyScore(b)
  if (d !== 0) return d
  const fa = a.end_date ?? a.due_date
  const fb = b.end_date ?? b.due_date
  if (fa !== fb) {
    if (!fa) return 1
    if (!fb) return -1
    return fa.localeCompare(fb)
  }
  return a.title.localeCompare(b.title, 'es')
}

/** Franja de color del borde: cálida cuando pide atención, neutra cuando no. */
export const URGENCIA_STRIPE: Record<Urgencia, string> = {
  vencida: 'bg-red-500',
  activa: 'bg-orange-500',
  manana: 'bg-amber-500',
  semana: 'bg-zinc-500',
  futura: 'bg-zinc-700',
  sin_fecha: 'bg-transparent',
}

/**
 * Cómo se lee la fecha en una tarjeta. Cuando falta poco gana la palabra
 * ("Hoy", "En curso", "Venció hace 3 días"); cuando falta mucho gana la fecha,
 * que es lo que sirve para planificar.
 */
export function describeWhen(task: TeamTask): string {
  if (!task.due_date) return ''
  const u = urgenciaDe(task)
  const tieneRango = !!task.end_date && task.end_date > task.due_date

  if (u === 'vencida') {
    const dias = Math.abs(daysFromToday(task.end_date ?? task.due_date))
    return dias === 1 ? 'Venció ayer' : `Venció hace ${dias} días`
  }
  if (u === 'activa') {
    if (!tieneRango) return 'Hoy'
    const hasta = parseDay(task.end_date!).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    return `En curso · hasta ${hasta}`
  }
  if (u === 'manana' && !tieneRango) return 'Mañana'

  return formatRange(task)
}

/** Fecha, o "3 – 8 sept" cuando la tarea ocupa un rango. */
export function formatRange(task: TeamTask): string {
  if (!task.due_date) return ''
  const desde = parseDay(task.due_date)
  if (!task.end_date || task.end_date <= task.due_date) {
    return desde.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  }
  const hasta = parseDay(task.end_date)
  const mismoMes = desde.getMonth() === hasta.getMonth()
  return `${desde.toLocaleDateString('es-ES', mismoMes ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${hasta.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}

// ── Estilos compartidos ───────────────────────────────────────────────────────

export const PRIORITY_STYLE: Record<TeamTaskPriority, string> = {
  alta: 'text-red-400 bg-red-950/40 border-red-900/40',
  media: 'text-amber-400 bg-amber-950/30 border-amber-900/30',
  baja: 'text-zinc-400 bg-zinc-800/60 border-zinc-700/50',
}

/** Color estable por persona, para reconocerla de un vistazo en el calendario. */
const PERSON_COLORS = [
  'bg-violet-500/15 text-violet-300 border-violet-500/25',
  'bg-blue-500/15 text-blue-300 border-blue-500/25',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  'bg-amber-500/15 text-amber-300 border-amber-500/25',
  'bg-rose-500/15 text-rose-300 border-rose-500/25',
  'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25',
]

export function personColor(name: string | null): string {
  if (!name) return 'bg-zinc-800 text-zinc-400 border-zinc-700'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PERSON_COLORS[hash % PERSON_COLORS.length]
}

export function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

/**
 * Marca la tarea hecha/pendiente. Es optimista: si Notion rechaza el cambio,
 * la acción del servidor revierte y acá se vuelve al estado anterior, porque
 * mostrar "hecha" en el CRM mientras en Notion sigue pendiente es lo peor que
 * puede pasar en una coordinación de lanzamiento.
 */
export function TaskCheckbox({
  task,
  clientId,
  disabled,
  onChanged,
}: {
  task: TeamTask
  clientId: string
  disabled?: boolean
  onChanged: (task: TeamTask) => void
}) {
  const [saving, setSaving] = useState(false)
  const done = task.status === 'hecha'

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (saving || disabled) return
    const next = done ? 'pendiente' : 'hecha'
    setSaving(true)
    onChanged({ ...task, status: next })

    const result = await setTaskStatusAction(clientId, task.id, next).catch((err) => ({
      success: false as const,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }))

    setSaving(false)
    if (!result.success) {
      onChanged(task)
      alert(result.error)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={disabled || saving}
      title={disabled ? 'Solo la persona asignada puede marcarla' : done ? 'Marcar como pendiente' : 'Marcar como hecha'}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
        done ? 'border-emerald-500 bg-emerald-500 text-zinc-950' : 'border-zinc-600 hover:border-zinc-400',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      {saving ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  )
}

// ── Fila de tarea ─────────────────────────────────────────────────────────────

export function TaskRow({
  task,
  clientId,
  canCheck,
  showAssignee = true,
  onChanged,
  onOpen,
}: {
  task: TeamTask
  clientId: string
  canCheck: boolean
  showAssignee?: boolean
  onChanged: (task: TeamTask) => void
  onOpen: (task: TeamTask) => void
}) {
  const done = task.status === 'hecha'
  const urgencia = urgenciaDe(task)

  return (
    <div
      onClick={() => onOpen(task)}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-white/[0.06] hover:bg-white/[0.02]"
    >
      <TaskCheckbox task={task} clientId={clientId} disabled={!canCheck} onChanged={onChanged} />

      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm', done ? 'text-zinc-600 line-through' : 'text-zinc-200')}>{task.title}</p>
        {task.group_name && <p className="mt-0.5 truncate text-[11px] text-zinc-600">{task.group_name}</p>}
      </div>

      {task.status === 'en_progreso' && (
        <span className="hidden shrink-0 rounded-md border border-blue-900/40 bg-blue-950/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-400 sm:inline">
          En progreso
        </span>
      )}

      {task.priority && task.priority !== 'media' && !done && (
        <span className={cn('hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium sm:inline', PRIORITY_STYLE[task.priority])}>
          {task.priority === 'alta' ? 'Alta' : 'Baja'}
        </span>
      )}

      {task.due_date && (
        <span
          className={cn(
            'shrink-0 text-[11px] tabular-nums',
            done
              ? 'text-zinc-700'
              : urgencia === 'vencida'
                ? 'font-medium text-red-400'
                : urgencia === 'activa'
                  ? 'font-medium text-orange-400'
                  : urgencia === 'manana'
                    ? 'text-amber-400'
                    : 'text-zinc-500'
          )}
        >
          {describeWhen(task)}
        </span>
      )}

      {showAssignee && (
        <span
          title={task.assignee_name ?? 'Sin responsable'}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium',
            personColor(task.assignee_name)
          )}
        >
          {initials(task.assignee_name)}
        </span>
      )}
    </div>
  )
}

// ── Panel de detalle ──────────────────────────────────────────────────────────

/** Lo que el CRM puede editar, según el rol y lo que soporte la base de Notion. */
export interface TaskEditContext {
  canEdit: boolean
  assigneeEditable: boolean
  options: { assignee: string[]; priority: string[]; group: string[] }
}

function BlockView({
  block,
  canCheck,
  onToggle,
}: {
  block: NotionBlock
  canCheck: boolean
  onToggle: (block: NotionBlock, checked: boolean) => void
}) {
  switch (block.type) {
    case 'titulo':
      return <h4 className="mt-4 text-sm font-semibold text-zinc-100">{block.text}</h4>
    case 'vineta':
      return <li className="ml-4 list-disc text-sm text-zinc-300">{block.text}</li>
    case 'numerada':
      return <li className="ml-4 list-decimal text-sm text-zinc-300">{block.text}</li>
    case 'checklist':
      return (
        <div className="flex items-start gap-2 text-sm">
          <button
            onClick={() => canCheck && onToggle(block, !block.checked)}
            disabled={!canCheck}
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
              block.checked ? 'border-emerald-500 bg-emerald-500 text-zinc-950' : 'border-zinc-600',
              canCheck ? 'hover:border-zinc-400' : 'cursor-not-allowed opacity-60'
            )}
          >
            {block.checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </button>
          <span className={block.checked ? 'text-zinc-500 line-through' : 'text-zinc-300'}>{block.text}</span>
        </div>
      )
    case 'cita':
      return <p className="border-l-2 border-zinc-700 pl-3 text-sm italic text-zinc-400">{block.text}</p>
    case 'codigo':
      return <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">{block.text}</pre>
    case 'imagen':
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={block.url} alt="" className="max-w-full rounded-lg border border-white/[0.06]" />
    case 'divisor':
      return <hr className="border-white/[0.06]" />
    default:
      return <p className="text-sm leading-relaxed text-zinc-300">{block.text}</p>
  }
}

/**
 * Qué opción de Notion corresponde a la prioridad guardada. El espejo guarda
 * alta/media/baja, pero en Notion la opción puede llamarse "P1" o "Urgente":
 * se reconoce igual que al leerla (readPriority en services/notion.ts).
 */
function optionForPriority(options: string[], priority: TeamTaskPriority | null): string {
  if (!priority) return ''
  const re = priority === 'alta' ? /alta|high|urgen|p1/i : priority === 'baja' ? /baja|low|p3/i : /media|medium|normal|p2/i
  return options.find((o) => re.test(o)) ?? ''
}

/** Campo del panel: se ve como texto y se edita en el lugar si eres admin. */
function MetaField({
  icon: Icon,
  label,
  value,
  editable,
  children,
}: {
  icon: typeof User
  label: string
  value: string
  editable: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
        <Icon className="h-3 w-3" /> {label}
      </p>
      {editable && children ? children : <p className="mt-1 truncate text-sm text-zinc-200">{value}</p>}
    </div>
  )
}

export function TaskDetailDrawer({
  task,
  clientId,
  canCheck,
  edit,
  onClose,
  onChanged,
  onDeleted,
}: {
  task: TeamTask
  clientId: string
  canCheck: boolean
  edit: TaskEditContext
  onClose: () => void
  onChanged: (task: TeamTask) => void
  onDeleted?: (taskId: string) => void
}) {
  const [blocks, setBlocks] = useState<NotionBlock[] | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [note, setNote] = useState(task.completion_note ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [saving, setSaving] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [newItemKind, setNewItemKind] = useState<'checklist' | 'texto'>('checklist')

  useEffect(() => {
    let cancelled = false
    getTaskContentAction(clientId, task.id)
      .then((res) => {
        if (cancelled) return
        if (res.success) setBlocks(res.blocks)
        else setContentError(res.error)
      })
      .catch((e) => !cancelled && setContentError(e instanceof Error ? e.message : 'Error'))
    return () => {
      cancelled = true
    }
  }, [clientId, task.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Cada cambio va a Notion primero; si falla, se avisa y no se toca la vista. */
  async function saveFields(fields: Parameters<typeof updateTaskFieldsAction>[2], local: Partial<TeamTask>) {
    setSaving(true)
    const result = await updateTaskFieldsAction(clientId, task.id, fields).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    setSaving(false)
    if (result.success) onChanged({ ...task, ...local })
    else alert(result.error)
    return result.success
  }

  async function saveNote() {
    setSavingNote(true)
    const result = await setTaskStatusAction(clientId, task.id, task.status, note).catch((err) => ({
      success: false as const,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }))
    setSavingNote(false)
    if (result.success) onChanged({ ...task, completion_note: note.trim() || null })
    else alert(result.error)
  }

  async function toggleBlock(block: NotionBlock, checked: boolean) {
    setBlocks((prev) => prev?.map((b) => (b.id === block.id ? { ...b, checked } : b)) ?? prev)
    const result = await toggleTaskTodoAction(clientId, task.id, block.id, checked).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    if (!result.success) {
      setBlocks((prev) => prev?.map((b) => (b.id === block.id ? { ...b, checked: !checked } : b)) ?? prev)
      alert(result.error)
    }
  }

  async function addItem() {
    const text = newItem.trim()
    if (!text) return
    setNewItem('')
    const result = await appendTaskBlockAction(clientId, task.id, text, newItemKind).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    if (result.success) setBlocks(result.blocks)
    else {
      setNewItem(text)
      alert(result.error)
    }
  }

  async function remove() {
    if (!confirm(`¿Borrar "${task.title}"? Se archiva en Notion (queda en la papelera, se puede recuperar).`)) return
    setSaving(true)
    const result = await deleteTaskAction(clientId, task.id).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    setSaving(false)
    if (result.success) {
      onDeleted?.(task.id)
      onClose()
    } else alert(result.error)
  }

  const selectCls =
    'mt-1 w-full rounded border border-white/[0.06] bg-zinc-900 px-1.5 py-1 text-sm text-zinc-200 focus:border-white/[0.15] focus:outline-none [&>option]:bg-zinc-900 [&>option]:text-zinc-100'

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-enter flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-zinc-950 shadow-2xl sm:max-w-lg">
        <div className="flex items-start gap-3 border-b border-white/[0.06] p-5">
          <TaskCheckbox task={task} clientId={clientId} disabled={!canCheck} onChanged={onChanged} />
          {edit.canEdit ? (
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== task.title && saveFields({ title }, { title: title.trim() })}
              rows={2}
              className="flex-1 resize-none rounded border border-transparent bg-transparent text-base font-semibold leading-snug text-zinc-100 hover:border-white/[0.08] focus:border-white/[0.15] focus:outline-none"
            />
          ) : (
            <h3 className={cn('flex-1 text-base font-semibold leading-snug', task.status === 'hecha' ? 'text-zinc-500 line-through' : 'text-zinc-100')}>
              {task.title}
            </h3>
          )}
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {saving && <p className="text-[11px] text-zinc-600">Guardando en Notion…</p>}

          <div className="grid grid-cols-2 gap-3">
            <MetaField
              icon={User}
              label="Responsable"
              value={task.assignee_name ?? 'Sin asignar'}
              editable={edit.canEdit && edit.assigneeEditable}
            >
              <select
                value={task.assignee_name ?? ''}
                onChange={(e) => saveFields({ assignee: e.target.value || null }, { assignee_name: e.target.value || null })}
                className={selectCls}
              >
                <option value="">Sin asignar</option>
                {edit.options.assignee.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </MetaField>

            <MetaField icon={CalendarDays} label="Fecha" value={task.due_date ? formatDue(task.due_date) : 'Sin fecha'} editable={edit.canEdit}>
              <input
                type="date"
                value={task.due_date ?? ''}
                onChange={(e) => saveFields({ due_date: e.target.value || null }, { due_date: e.target.value || null })}
                className={selectCls}
              />
            </MetaField>

            <MetaField
              icon={Flag}
              label="Prioridad"
              value={task.priority ? task.priority[0].toUpperCase() + task.priority.slice(1) : 'Sin prioridad'}
              editable={edit.canEdit && edit.options.priority.length > 0}
            >
              <select
                value={optionForPriority(edit.options.priority, task.priority)}
                onChange={(e) => saveFields({ priority: e.target.value || null }, {})}
                className={selectCls}
              >
                <option value="">Sin prioridad</option>
                {edit.options.priority.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </MetaField>

            <MetaField
              icon={Layers}
              label="Fase"
              value={task.group_name ?? 'Sin fase'}
              editable={edit.canEdit && edit.options.group.length > 0}
            >
              <select
                value={task.group_name ?? ''}
                onChange={(e) => saveFields({ group: e.target.value || null }, { group_name: e.target.value || null })}
                className={selectCls}
              >
                <option value="">Sin fase</option>
                {edit.options.group.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </MetaField>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">Detalle en Notion</p>
            {contentError ? (
              <p className="text-sm text-zinc-500">{contentError}</p>
            ) : blocks === null ? (
              <p className="animate-pulse text-sm text-zinc-600">Cargando contenido…</p>
            ) : blocks.length === 0 ? (
              <p className="text-sm text-zinc-600">Esta tarea todavía no tiene contenido.</p>
            ) : (
              <div className="space-y-2">
                {blocks.map((b) => (
                  <BlockView key={b.id} block={b} canCheck={canCheck} onToggle={toggleBlock} />
                ))}
              </div>
            )}

            {/* Agregar contenido a la página de Notion desde el CRM */}
            {canCheck && (
              <div className="mt-3 flex items-center gap-1.5">
                <button
                  onClick={() => setNewItemKind((k) => (k === 'checklist' ? 'texto' : 'checklist'))}
                  title={newItemKind === 'checklist' ? 'Agregar como ítem de checklist' : 'Agregar como texto'}
                  className="shrink-0 rounded border border-white/[0.08] p-1.5 text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {newItemKind === 'checklist' ? <ListChecks className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}
                </button>
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  placeholder={newItemKind === 'checklist' ? 'Agregar un ítem…' : 'Agregar una nota…'}
                  className="flex-1 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.12] focus:outline-none"
                />
                <button
                  onClick={addItem}
                  disabled={!newItem.trim()}
                  className="shrink-0 rounded border border-white/[0.08] p-1.5 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">Tu nota de avance</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== (task.completion_note ?? '') && saveNote()}
              rows={3}
              placeholder="¿Qué avanzaste? ¿Quedó algo trabado?"
              disabled={!canCheck}
              className="w-full resize-y rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.12] focus:outline-none disabled:opacity-50"
            />
            {savingNote && <p className="mt-1 text-[11px] text-zinc-600">Guardando…</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.06] p-4">
          {task.notion_url && (
            <a
              href={task.notion_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir en Notion
            </a>
          )}
          {edit.canEdit && (
            <button
              onClick={remove}
              disabled={saving}
              title="Archivar en Notion"
              className="rounded-lg border border-white/[0.08] p-2 text-zinc-500 transition-colors hover:border-red-900/50 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
