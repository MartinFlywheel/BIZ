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
import { TASK_STATUS_LABEL } from '@/lib/types'
import { cn, formatRelativeTime } from '@/lib/utils'
import { TaskRow, TaskDetailDrawer, TaskCheckbox, isOverdue, parseDay, todayISO, personColor, initials, type TaskEditContext } from './task-ui'
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

      {visible.length === 0 ? (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] py-16 text-center text-sm text-zinc-500">
          No hay tareas que coincidan con el filtro.
        </div>
      ) : view === 'lista' ? (
        <ListView tasks={visible} clientId={clientId} canCheck={canCheck} onChanged={applyChange} onOpen={setOpenTask} />
      ) : view === 'tablero' ? (
        <BoardView tasks={visible} clientId={clientId} canCheck={canCheck} onChanged={applyChange} onOpen={setOpenTask} />
      ) : (
        <CalendarView
          tasks={visible}
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
  clientId,
  canCheck,
  onChanged,
  onOpen,
}: {
  tasks: TeamTask[]
  clientId: string
  canCheck: (t: TeamTask) => boolean
  onChanged: (t: TeamTask) => void
  onOpen: (t: TeamTask) => void
}) {
  // Agrupadas por la fase de Notion; las que no tienen fase van al final.
  const groups = useMemo(() => {
    const map = new Map<string, TeamTask[]>()
    for (const t of tasks) {
      const key = t.group_name ?? 'Sin fase'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Sin fase' ? 1 : b === 'Sin fase' ? -1 : a.localeCompare(b)))
  }, [tasks])

  return (
    <div className="space-y-5">
      {groups.map(([name, items]) => (
        <div key={name}>
          <div className="mb-1 flex items-center gap-2 px-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{name}</h3>
            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{items.length}</span>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-1">
            {items.map((t) => (
              <TaskRow key={t.id} task={t} clientId={clientId} canCheck={canCheck(t)} onChanged={onChanged} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Vista tablero ─────────────────────────────────────────────────────────────

function BoardView({
  tasks,
  clientId,
  canCheck,
  onChanged,
  onOpen,
}: {
  tasks: TeamTask[]
  clientId: string
  canCheck: (t: TeamTask) => boolean
  onChanged: (t: TeamTask) => void
  onOpen: (t: TeamTask) => void
}) {
  const columns: TeamTaskStatus[] = ['pendiente', 'en_progreso', 'hecha']

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {columns.map((status) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <div key={status} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2">
            <div className="mb-2 flex items-center gap-2 px-2 pt-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{TASK_STATUS_LABEL[status]}</h3>
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onOpen(t)}
                  className="cursor-pointer rounded-lg border border-white/[0.05] bg-zinc-900/60 p-2.5 transition-colors hover:border-white/[0.12]"
                >
                  <div className="flex items-start gap-2">
                    <TaskCheckbox task={t} clientId={clientId} disabled={!canCheck(t)} onChanged={onChanged} />
                    <p className={cn('flex-1 text-sm leading-snug', t.status === 'hecha' ? 'text-zinc-600 line-through' : 'text-zinc-200')}>
                      {t.title}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    {t.assignee_name && (
                      <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px]', personColor(t.assignee_name))}>{t.assignee_name}</span>
                    )}
                    {t.due_date && (
                      <span className={cn('text-[10px] tabular-nums', isOverdue(t) ? 'text-red-400' : 'text-zinc-500')}>
                        {parseDay(t.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-zinc-700">Vacío</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Vista calendario ──────────────────────────────────────────────────────────

function CalendarView({
  tasks,
  cursor,
  onCursor,
  onOpen,
}: {
  tasks: TeamTask[]
  cursor: { year: number; month: number }
  onCursor: (c: { year: number; month: number }) => void
  onOpen: (t: TeamTask) => void
}) {
  const today = todayISO()

  // La grilla arranca el lunes de la semana del día 1 y cubre semanas enteras.
  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const offset = (first.getDay() + 6) % 7
    const start = new Date(cursor.year, cursor.month, 1 - offset)
    const total = Math.ceil((offset + new Date(cursor.year, cursor.month + 1, 0).getDate()) / 7) * 7
    return Array.from({ length: total }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [cursor])

  const byDay = useMemo(() => {
    const map = new Map<string, TeamTask[]>()
    for (const t of tasks) {
      if (!t.due_date) continue
      if (!map.has(t.due_date)) map.set(t.due_date, [])
      map.get(t.due_date)!.push(t)
    }
    return map
  }, [tasks])

  const undated = tasks.filter((t) => !t.due_date)

  function iso(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

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

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.04]">
            {days.map((d) => {
              const key = iso(d)
              const items = byDay.get(key) ?? []
              const isCurrentMonth = d.getMonth() === cursor.month
              const isToday = key === today

              return (
                <div
                  key={key}
                  className={cn(
                    'min-h-[92px] bg-zinc-950 p-1.5 transition-colors',
                    !isCurrentMonth && 'bg-zinc-950/40',
                    isToday && 'bg-violet-950/20'
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                      isToday ? 'bg-violet-600 font-medium text-white' : isCurrentMonth ? 'text-zinc-400' : 'text-zinc-700'
                    )}
                  >
                    {d.getDate()}
                  </span>

                  <div className="mt-1 space-y-1">
                    {items.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onOpen(t)}
                        title={`${t.title}${t.assignee_name ? ` — ${t.assignee_name}` : ''}`}
                        className={cn(
                          'flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] transition-opacity hover:opacity-80',
                          t.status === 'hecha' ? 'border-zinc-800 bg-zinc-900 text-zinc-600 line-through' : personColor(t.assignee_name),
                          isOverdue(t) && 'ring-1 ring-red-500/40'
                        )}
                      >
                        <span className="font-medium">{initials(t.assignee_name)}</span>
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))}
                    {items.length > 3 && <p className="pl-1 text-[10px] text-zinc-600">+{items.length - 3} más</p>}
                  </div>
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
        Ejecutá <code className="rounded bg-amber-950/40 px-1">supabase/036-team-tasks.sql</code> en el editor SQL de Supabase y recargá.
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
          Vos planificás en Notion; el equipo ve sus tareas acá adentro y las marca. No necesitan cuenta de Notion.
        </p>
      </div>

      <ol className="space-y-2 text-sm text-zinc-400">
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">1.</span>
          <span>
            Creá una integración interna en{' '}
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
              notion.so/my-integrations
            </a>{' '}
            y copiá el token en la variable <code className="rounded bg-zinc-800 px-1 text-[11px]">NOTION_TOKEN</code>.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">2.</span>
          <span>Abrí la base de tareas en Notion → menú ••• → Conexiones → agregá esa integración.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-xs text-zinc-600">3.</span>
          <span>Pegá acá el link de esa base.</span>
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
