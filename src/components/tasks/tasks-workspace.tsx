'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Search,
  List,
  Columns3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Link2,
  AlertTriangle,
  Plus,
  Layers,
} from 'lucide-react'
import { connectNotionAction, disconnectNotionAction, syncNotionTasksAction, getTaskBoard, type TaskBoardData } from '@/lib/actions/tasks'
import type { TeamTask, TeamTaskStatus } from '@/lib/types'
import { TASK_STATUS_LABEL, TASK_PRIORITY_LABEL } from '@/lib/types'
import { cn, formatRelativeTime } from '@/lib/utils'
import { TaskRow, TaskDetailDrawer, TaskCheckbox, isOverdue, todayISO, personColor, initials, formatRange, describeWhen, byUrgency, urgenciaDe, soloEtapas, etapaDe, etapaActual, URGENCIA_STRIPE, PRIORITY_STYLE, type TaskEditContext } from './task-ui'
import { NewTaskModal } from './new-task-modal'
import { FieldOptionsModal } from './field-options-modal'

type View = 'lista' | 'tablero' | 'calendario'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Se resincroniza solo si el espejo tiene más de este tiempo. Notion tarda
// ~1s por consulta, así que no tiene sentido pegarle en cada navegación.
const STALE_MS = 3 * 60 * 1000

export function TasksWorkspace({ clientId, clientName, initialData }: { clientId: string; clientName: string; initialData: TaskBoardData }) {
  const [tasks, setTasks] = useState<TeamTask[]>(initialData.tasks)
  const [config, setConfig] = useState(initialData.config)
  const [view, setView] = useState<View>('lista')
  const [search, setSearch] = useState('')
  const [personFilter, setPersonFilter] = useState<string>(initialData.canEdit ? 'todos' : 'mias')
  const [statusFilter, setStatusFilter] = useState<'abiertas' | 'todas' | TeamTaskStatus>('abiertas')
  const [openTask, setOpenTask] = useState<TeamTask | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingPhases, setEditingPhases] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const { viewerId, viewerName, canEdit } = initialData

  async function runSync(silent = false) {
    if (!silent) setSyncing(true)
    setSyncError(null)
    const result = await syncNotionTasksAction(clientId).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    setSyncing(false)
    if (!result.success) {
      setSyncError(result.error)
      return
    }
    // La acción revalida la ruta, pero el estado local es lo que se ve: se
    // vuelve a pedir el tablero para no depender del refresh del router.
    const fresh = await getTaskBoard(clientId)
    setTasks(fresh.tasks)
    setConfig(fresh.config)
  }

  useEffect(() => {
    if (!config.connected) return
    const stale = !config.syncedAt || Date.now() - new Date(config.syncedAt).getTime() > STALE_MS
    if (!stale) return

    let cancelled = false
    void (async () => {
      const result = await syncNotionTasksAction(clientId).catch(() => ({ success: false as const, error: '' }))
      if (cancelled || !result.success) return
      const fresh = await getTaskBoard(clientId)
      if (cancelled) return
      setTasks(fresh.tasks)
      setConfig(fresh.config)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.connected])

  function applyChange(updated: TeamTask) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setOpenTask((prev) => (prev?.id === updated.id ? updated : prev))
  }

  const people = useMemo(() => {
    const names = new Set<string>()
    for (const t of tasks) if (t.assignee_name) names.add(t.assignee_name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [tasks])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (statusFilter === 'abiertas' && t.status === 'hecha') return false
      if (statusFilter !== 'abiertas' && statusFilter !== 'todas' && t.status !== statusFilter) return false
      if (personFilter === 'mias' && t.assigned_to !== viewerId) return false
      if (personFilter !== 'todos' && personFilter !== 'mias' && t.assignee_name !== personFilter) return false
      if (q && !t.title.toLowerCase().includes(q) && !(t.group_name ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, search, personFilter, statusFilter, viewerId])

  // Las etapas salen de TODAS las tareas y no de `visible`: filtrar por
  // persona o por estado no debería borrar el contexto del período en el que
  // está el lanzamiento. Las tareas, en cambio, sí respetan el filtro.
  const etapas = useMemo(() => soloEtapas(tasks), [tasks])
  const visibleTareas = useMemo(() => visible.filter((t) => !t.is_stage), [visible])

  const canCheck = (task: TeamTask) => canEdit || task.assigned_to === viewerId

  const edit: TaskEditContext = {
    canEdit,
    assigneeEditable: config.assigneeEditable,
    options: config.options,
  }

  function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  // ── Sin conectar ────────────────────────────────────────────────────────────
  if (!config.connected) {
    return (
      <div className="space-y-6">
        <Header clientId={clientId} clientName={clientName} />
        {config.needsMigration ? (
          <MigrationNotice />
        ) : (
          <ConnectPanel clientId={clientId} canEdit={canEdit} onConnected={() => window.location.reload()} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Header clientId={clientId} clientName={clientName}>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              <Plus className="h-3.5 w-3.5" /> Nueva tarea
            </button>
          )}
          <button
            onClick={() => runSync()}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          {config.databaseUrl && (
            <a
              href={config.databaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir en Notion
            </a>
          )}
        </div>
      </Header>

      <p className="-mt-3 text-xs text-zinc-600">
        Espejo de <span className="text-zinc-400">{config.databaseTitle}</span>
        {config.syncedAt && <> · actualizado {formatRelativeTime(config.syncedAt)}</>}
      </p>

      {syncError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{syncError}</span>
        </div>
      )}

      {/* Filtros + selector de vista */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarea…"
            className="w-48 rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.12] focus:outline-none"
          />
        </div>

        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
        >
          <option value="todos">Todo el equipo</option>
          <option value="mias">Mis tareas ({viewerName})</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
        >
          <option value="abiertas">Sin terminar</option>
          <option value="todas">Todas</option>
          <option value="pendiente">Pendientes</option>
          <option value="en_progreso">En progreso</option>
          <option value="hecha">Hechas</option>
        </select>

        {canEdit && (
          <button
            onClick={() => setEditingPhases(true)}
            title="Agregar, renombrar o borrar fases en Notion"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
          >
            <Layers className="h-3.5 w-3.5" /> Fases
          </button>
        )}

        <div className={cn('flex items-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5', !canEdit && 'ml-auto')}>
          {([
            { id: 'lista', icon: List, label: 'Lista' },
            { id: 'tablero', icon: Columns3, label: 'Tablero' },
            { id: 'calendario', icon: CalendarDays, label: 'Calendario' },
          ] as const).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                view === v.id ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {visibleTareas.length === 0 && view !== 'calendario' ? (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] py-16 text-center text-sm text-zinc-500">
          No hay tareas que coincidan con el filtro.
        </div>
      ) : view === 'lista' ? (
        <ListView tasks={visibleTareas} etapas={etapas} clientId={clientId} canCheck={canCheck} onChanged={applyChange} onOpen={setOpenTask} />
      ) : view === 'tablero' ? (
        <BoardView tasks={visibleTareas} etapas={etapas} clientId={clientId} canCheck={canCheck} onChanged={applyChange} onOpen={setOpenTask} />
      ) : (
        <CalendarView
          tasks={visibleTareas}
          etapas={etapas}
          cursor={monthCursor}
          onCursor={setMonthCursor}
          onOpen={setOpenTask}
        />
      )}

      {canEdit && <DangerZone clientId={clientId} />}

      {openTask && (
        <TaskDetailDrawer
          key={openTask.id}
          task={openTask}
          clientId={clientId}
          canCheck={canCheck(openTask)}
          edit={edit}
          onClose={() => setOpenTask(null)}
          onChanged={applyChange}
          onDeleted={removeTask}
        />
      )}

      {editingPhases && (
        <FieldOptionsModal
          clientId={clientId}
          field="group"
          label="Fases"
          onClose={() => setEditingPhases(false)}
          onSaved={() => {
            setEditingPhases(false)
            void runSync()
          }}
        />
      )}

      {creating && (
        <NewTaskModal
          clientId={clientId}
          edit={edit}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void runSync()
          }}
        />
      )}
    </div>
  )
}

// ── Cabecera ──────────────────────────────────────────────────────────────────

function Header({ clientId, clientName, children }: { clientId: string; clientName: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link
          href={`/clients/${clientId}?tab=crm`}
          className="mb-1 inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {clientName}
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-50">Tareas del equipo</h1>
      </div>
      {children}
    </div>
  )
}

// ── Vista lista ───────────────────────────────────────────────────────────────

function ListView({
  tasks,
  etapas,
  clientId,
  canCheck,
  onChanged,
  onOpen,
}: {
  tasks: TeamTask[]
  etapas: TeamTask[]
  clientId: string
  canCheck: (t: TeamTask) => boolean
  onChanged: (t: TeamTask) => void
  onOpen: (t: TeamTask) => void
}) {
  // Agrupadas por la ETAPA en la que cae su fecha, no por la fase de Notion:
  // la etapa es el período real del lanzamiento y es lo que Martín calendariza.
  // Las que no caen en ninguna van al final.
  const groups = useMemo(() => {
    const map = new Map<string, { etapa: TeamTask | null; items: TeamTask[] }>()
    for (const t of tasks) {
      const etapa = etapaDe(t, etapas)
      const key = etapa?.id ?? '__sin__'
      if (!map.has(key)) map.set(key, { etapa, items: [] })
      map.get(key)!.items.push(t)
    }
    for (const g of map.values()) g.items.sort(byUrgency)
    return [...map.values()].sort((a, b) => {
      if (!a.etapa) return 1
      if (!b.etapa) return -1
      return (a.etapa.due_date ?? '').localeCompare(b.etapa.due_date ?? '')
    })
  }, [tasks, etapas])

  return (
    <div className="space-y-5">
      {groups.map(({ etapa, items }) => {
        const enCurso = etapa ? urgenciaDe(etapa) === 'activa' : false
        return (
          <div key={etapa?.id ?? '__sin__'}>
            <div className="mb-1 flex items-center gap-2 px-3">
              {etapa ? (
                <button
                  onClick={() => onOpen(etapa)}
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wider transition-colors',
                    enCurso ? 'text-violet-300 hover:text-violet-200' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {etapa.title}
                </button>
              ) : (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600">Sin etapa</h3>
              )}
              {etapa && <span className="text-[11px] tabular-nums text-zinc-600">{formatRange(etapa)}</span>}
              {enCurso && (
                <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                  En curso
                </span>
              )}
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{items.length}</span>
            </div>
            <div className={cn('rounded-xl border bg-white/[0.02] p-1', enCurso ? 'border-violet-500/20' : 'border-white/[0.05]')}>
              {items.map((t) => (
                <TaskRow key={t.id} task={t} clientId={clientId} canCheck={canCheck(t)} onChanged={onChanged} onOpen={onOpen} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Vista tablero ─────────────────────────────────────────────────────────────

function BoardView({
  tasks,
  etapas,
  clientId,
  canCheck,
  onChanged,
  onOpen,
}: {
  tasks: TeamTask[]
  etapas: TeamTask[]
  clientId: string
  canCheck: (t: TeamTask) => boolean
  onChanged: (t: TeamTask) => void
  onOpen: (t: TeamTask) => void
}) {
  const columns: TeamTaskStatus[] = ['pendiente', 'en_progreso', 'hecha']
  const actual = etapaActual(etapas)

  return (
    <div className="space-y-3">
      {/* Las etapas no son tarjetas del tablero: son el contexto. Acá va la que
          corre hoy, para no perder de vista en qué parte del lanzamiento están. */}
      {actual && (
        <button
          onClick={() => onOpen(actual)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3.5 py-2.5 text-left transition-colors hover:bg-violet-500/15"
        >
          <Layers className="h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400/70">Etapa actual</span>
          <span className="truncate text-sm font-semibold uppercase tracking-wide text-violet-100">{actual.title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-violet-300/70">{formatRange(actual)}</span>
        </button>
      )}

    <div className="grid gap-3 sm:grid-cols-3">
      {columns.map((status) => {
        const items = tasks.filter((t) => t.status === status).sort(byUrgency)
        // Lo que ya pide atencion hoy: vencido o en curso. Es el numero que
        // importa al abrir el tablero, mas que cuantas altas hay marcadas.
        const urgentes = status === 'hecha'
          ? 0
          : items.filter((t) => ['vencida', 'activa'].includes(urgenciaDe(t))).length

        return (
          <div key={status} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2">
            <div className="mb-2 flex items-center gap-2 px-2 pt-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{TASK_STATUS_LABEL[status]}</h3>
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{items.length}</span>
              {/* Cuántas urgencias hay en esta columna, sin tener que contarlas. */}
              {urgentes > 0 && (
                <span className="ml-auto rounded-full border border-red-900/40 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
                  {urgentes} urgente{urgentes === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {items.map((t) => {
                const hecha = t.status === 'hecha'
                return (
                  <div
                    key={t.id}
                    onClick={() => onOpen(t)}
                    className="group relative cursor-pointer overflow-hidden rounded-lg border border-white/[0.05] bg-zinc-900/60 p-2.5 pl-3 transition-colors hover:border-white/[0.12]"
                  >
                    {/* Franja de prioridad: se lee de un vistazo al recorrer la
                        columna, sin sumar una insignia más al ruido de la tarjeta. */}
                    {!hecha && (
                      <span className={cn('absolute inset-y-0 left-0 w-[3px]', URGENCIA_STRIPE[urgenciaDe(t)])} aria-hidden />
                    )}

                    <div className="flex items-start gap-2">
                      <TaskCheckbox task={t} clientId={clientId} disabled={!canCheck(t)} onChanged={onChanged} />
                      <p className={cn('flex-1 text-sm leading-snug', hecha ? 'text-zinc-600 line-through' : 'text-zinc-200')}>
                        {t.title}
                      </p>
                    </div>

                    {t.group_name && (
                      <p className="mt-1 truncate pl-6 text-[11px] text-zinc-600">{t.group_name}</p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6">
                      {t.priority && !hecha && (
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_STYLE[t.priority])}>
                          {TASK_PRIORITY_LABEL[t.priority]}
                        </span>
                      )}
                      {t.assignee_name && (
                        <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px]', personColor(t.assignee_name))}>{t.assignee_name}</span>
                      )}
                      {t.due_date && (
                        <span
                          className={cn(
                            'text-[10px] tabular-nums',
                            isOverdue(t)
                              ? 'font-medium text-red-400'
                              : urgenciaDe(t) === 'activa'
                                ? 'font-medium text-orange-400'
                                : 'text-zinc-500'
                          )}
                        >
                          {describeWhen(t)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-zinc-700">Vacío</p>}
            </div>
          </div>
        )
      })}
    </div>
    </div>
  )
}

// ── Vista calendario ──────────────────────────────────────────────────────────

interface WeekSegment {
  task: TeamTask
  col: number      // 0-6, dónde empieza dentro de esta semana
  span: number     // cuántos días ocupa dentro de esta semana
  cortadaIzq: boolean
  cortadaDer: boolean
  lane: number
}

/** Inicio y fin reales de una tarea. Sin end_date, ocupa un solo día. */
function rangoDe(t: TeamTask): { start: string; end: string } | null {
  if (!t.due_date) return null
  return { start: t.due_date, end: t.end_date && t.end_date > t.due_date ? t.end_date : t.due_date }
}

/**
 * Coloca en carriles lo que cae dentro de una semana, como hace Notion: una
 * barra por elemento que cruza los días que ocupa, y las que se solapan bajan
 * un carril.
 *
 * Antes cada tarea era un chip en el día de `due_date` y nada más, así que una
 * etapa de seis días se veía como un día suelto y el calendario del dashboard
 * no se parecía al de Notion.
 */
function armarSemana(diasIso: string[], items: TeamTask[]): { segmentos: WeekSegment[]; carriles: number } {
  const desde = diasIso[0]
  const hasta = diasIso[6]

  const crudos: WeekSegment[] = items.flatMap((task) => {
    const r = rangoDe(task)
    if (!r || r.end < desde || r.start > hasta) return []
    const col = r.start <= desde ? 0 : diasIso.indexOf(r.start)
    const colFin = r.end >= hasta ? 6 : diasIso.indexOf(r.end)
    if (col < 0 || colFin < 0) return []
    return [{
      task,
      col,
      span: colFin - col + 1,
      cortadaIzq: r.start < desde,
      cortadaDer: r.end > hasta,
      lane: 0,
    }]
  })

  // Las más largas primero, para que las barras grandes queden arriba y las
  // cortas rellenen huecos en vez de dejar la semana llena de escalones.
  crudos.sort((a, b) => a.col - b.col || b.span - a.span || a.task.title.localeCompare(b.task.title, 'es'))

  const ocupadoHasta: number[] = []
  for (const seg of crudos) {
    let lane = 0
    while (ocupadoHasta[lane] !== undefined && ocupadoHasta[lane] > seg.col) lane++
    seg.lane = lane
    ocupadoHasta[lane] = seg.col + seg.span
  }

  return { segmentos: crudos, carriles: ocupadoHasta.length }
}

function CalendarView({
  tasks,
  etapas,
  cursor,
  onCursor,
  onOpen,
}: {
  tasks: TeamTask[]
  etapas: TeamTask[]
  cursor: { year: number; month: number }
  onCursor: (c: { year: number; month: number }) => void
  onOpen: (t: TeamTask) => void
}) {
  const today = todayISO()

  // La grilla arranca el lunes de la semana del día 1 y cubre semanas enteras.
  const semanas = useMemo(() => {
    function iso(d: Date) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }
    const first = new Date(cursor.year, cursor.month, 1)
    const offset = (first.getDay() + 6) % 7
    const total = Math.ceil((offset + new Date(cursor.year, cursor.month + 1, 0).getDate()) / 7) * 7
    const dias = Array.from({ length: total }, (_, i) => new Date(cursor.year, cursor.month, 1 - offset + i))
    return Array.from({ length: total / 7 }, (_, w) => {
      const semana = dias.slice(w * 7, w * 7 + 7)
      return { dias: semana, diasIso: semana.map(iso) }
    })
  }, [cursor])

  const undated = tasks.filter((t) => !t.due_date)

  function shift(delta: number) {
    const d = new Date(cursor.year, cursor.month + delta, 1)
    onCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => shift(-1)} className="rounded-lg border border-white/[0.06] p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.05]">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <h3 className="min-w-[160px] text-sm font-medium text-zinc-200">
          {MONTHS[cursor.month]} {cursor.year}
        </h3>
        <button onClick={() => shift(1)} className="rounded-lg border border-white/[0.06] p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.05]">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            const now = new Date()
            onCursor({ year: now.getFullYear(), month: now.getMonth() })
          }}
          className="rounded-lg border border-white/[0.06] px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/[0.05]"
        >
          Hoy
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                {d}
              </div>
            ))}
          </div>

          <div className="space-y-px overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.04]">
            {semanas.map((semana, wi) => {
              // Las etapas van en sus propios carriles, arriba de las tareas:
              // son el contexto de la semana, no un elemento más que compite.
              const et = armarSemana(semana.diasIso, etapas)
              const ta = armarSemana(semana.diasIso, tasks)

              return (
                <div
                  key={wi}
                  className="grid grid-cols-7 gap-px"
                  style={{ gridTemplateRows: 'auto repeat(' + Math.max(et.carriles + ta.carriles, 1) + ', auto)' }}
                >
                  {/* Fondo de cada día: ocupa todas las filas de carriles para que
                      las barras crucen por encima de las divisiones entre días. */}
                  {semana.dias.map((d, i) => {
                    const key = semana.diasIso[i]
                    const delMes = d.getMonth() === cursor.month
                    return (
                      <div
                        key={'bg-' + key}
                        style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                        className={cn(
                          'min-h-[92px] bg-zinc-950',
                          !delMes && 'bg-zinc-950/40',
                          key === today && 'bg-violet-950/20'
                        )}
                      />
                    )
                  })}

                  {semana.dias.map((d, i) => {
                    const key = semana.diasIso[i]
                    const delMes = d.getMonth() === cursor.month
                    const esHoy = key === today
                    return (
                      <div key={'n-' + key} style={{ gridColumn: i + 1, gridRow: 1 }} className="relative z-10 p-1.5">
                        <span
                          className={cn(
                            'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                            esHoy ? 'bg-violet-600 font-medium text-white' : delMes ? 'text-zinc-400' : 'text-zinc-700'
                          )}
                        >
                          {d.getDate()}
                        </span>
                      </div>
                    )
                  })}

                  {/* Bandas de etapa: sin casilla, sin iniciales, sin color de
                      persona. Nombre en versalitas sobre un fondo apagado, para
                      que se lean como el período y no como algo que hacer. */}
                  {et.segmentos.map((seg) => {
                    const e = seg.task
                    const enCurso = urgenciaDe(e) === 'activa'
                    return (
                      <button
                        key={e.id}
                        onClick={() => onOpen(e)}
                        title={e.title + ' · ' + formatRange(e)}
                        style={{ gridColumn: (seg.col + 1) + ' / span ' + seg.span, gridRow: seg.lane + 2 }}
                        className={cn(
                          'relative z-10 mx-1 mb-1 truncate border px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80',
                          enCurso
                            ? 'border-violet-500/30 bg-violet-500/15 text-violet-200'
                            : 'border-white/[0.08] bg-white/[0.06] text-zinc-400',
                          seg.cortadaIzq ? 'ml-0 rounded-l-none border-l-0' : 'rounded-l',
                          seg.cortadaDer ? 'mr-0 rounded-r-none border-r-0' : 'rounded-r'
                        )}
                      >
                        {e.title}
                      </button>
                    )
                  })}

                  {ta.segmentos.map((seg) => {
                    const t = seg.task
                    const hecha = t.status === 'hecha'
                    return (
                      <button
                        key={t.id}
                        onClick={() => onOpen(t)}
                        title={t.title + (t.assignee_name ? ' — ' + t.assignee_name : '') + ' · ' + formatRange(t)}
                        style={{ gridColumn: (seg.col + 1) + ' / span ' + seg.span, gridRow: et.carriles + seg.lane + 2 }}
                        className={cn(
                          'relative z-10 mx-1 mb-1 flex items-center gap-1 border px-1.5 py-0.5 text-left text-[10px] transition-opacity hover:opacity-80',
                          hecha ? 'border-zinc-800 bg-zinc-900 text-zinc-600 line-through' : personColor(t.assignee_name),
                          isOverdue(t) && 'ring-1 ring-red-500/40',
                          // Los extremos cortados quedan rectos y pegados al borde:
                          // así se ve que la barra sigue en la semana de al lado.
                          seg.cortadaIzq ? 'ml-0 rounded-l-none border-l-0' : 'rounded-l',
                          seg.cortadaDer ? 'mr-0 rounded-r-none border-r-0' : 'rounded-r'
                        )}
                      >
                        {!seg.cortadaIzq && <span className="font-medium">{initials(t.assignee_name)}</span>}
                        <span className="truncate">{t.title}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">Sin fecha ({undated.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpen(t)}
                className={cn('rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80', personColor(t.assignee_name))}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Conexión con Notion ───────────────────────────────────────────────────────

function MigrationNotice() {
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/15 p-5 text-center">
      <p className="text-sm text-amber-300">Falta correr la migración de la base de datos.</p>
      <p className="mt-1 text-xs text-amber-200/70">
        Ejecuta <code className="rounded bg-amber-950/40 px-1">supabase/036-team-tasks.sql</code> en el editor SQL de Supabase y recarga la página.
      </p>
    </div>
  )
}

function ConnectPanel({ clientId, canEdit, onConnected }: { clientId: string; canEdit: boolean; onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) {
    return (
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] py-16 text-center text-sm text-zinc-500">
        Todavía no hay un tablero de tareas conectado para este cliente.
      </div>
    )
  }

  async function connect() {
    setBusy(true)
    setError(null)
    const result = await connectNotionAction(clientId, url).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    setBusy(false)
    if (result.success) onConnected()
    else setError(result.error)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
          <Link2 className="h-4 w-4 text-violet-400" /> Conectar la base de Notion
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Tú planificas en Notion; el equipo ve sus tareas aquí adentro y las marca. No necesitan cuenta de Notion.
        </p>
      </div>

      <ol className="space-y-2 text-sm text-zinc-400">
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">1.</span>
          <span>
            Crea una integración interna en{' '}
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
              notion.so/my-integrations
            </a>{' '}
            y copia el token en la variable <code className="rounded bg-zinc-800 px-1 text-[11px]">NOTION_TOKEN</code>.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">2.</span>
          <span>Abre la base de tareas en Notion → menú ••• → Conexiones → agrega esa integración.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">3.</span>
          <span>Pega aquí el link de esa base.</span>
        </li>
      </ol>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.notion.so/…"
          className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.12] focus:outline-none"
        />
        <button
          onClick={connect}
          disabled={busy || !url.trim()}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Conectar
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Para que cada tarea le llegue a la persona correcta, la propiedad de responsable en Notion tiene que tener el nombre tal como figura en la
        pestaña Equipo (o el mismo email).
      </p>
    </div>
  )
}

function DangerZone({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false)

  async function disconnect() {
    if (!confirm('¿Desconectar Notion? Se borra el espejo de tareas del CRM; en Notion no se toca nada.')) return
    setBusy(true)
    await disconnectNotionAction(clientId)
    window.location.reload()
  }

  return (
    <div className="flex justify-end pt-4">
      <button onClick={disconnect} disabled={busy} className="text-xs text-zinc-600 transition-colors hover:text-red-400 disabled:opacity-50">
        Desconectar Notion
      </button>
    </div>
  )
}
