'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ArrowUpRight, Bell, CheckCircle2, ChevronDown, AlertTriangle, Plus, Layers } from 'lucide-react'
import { getTaskBoard, syncNotionTasksAction, type TaskBoardData } from '@/lib/actions/tasks'
import type { TeamTask } from '@/lib/types'
import { cn } from '@/lib/utils'
import { TaskRow, TaskDetailDrawer, isOverdue, byUrgency, soloEtapas, etapaActual, formatRange, esMia, personColor, initials, type TaskEditContext } from './task-ui'
import { NewTaskModal } from './new-task-modal'

const STALE_MS = 3 * 60 * 1000

// Ver la nota en tasks-workspace.tsx: si el sync falla, syncedAt no avanza y
// este panel —que vive dentro de la pestaña CRM— relanzaría un sync completo
// contra Notion en cada visita a cualquier cliente.
const autoSyncFallido = new Set<string>()

/**
 * Lo que ve el equipo dentro del CRM, al lado de Equipo: el espejo de lo que
 * Martín configuró en Notion. Cada persona ve primero SUS pendientes (con el
 * aviso arriba), y el admin ve a todo el equipo repartido por responsable.
 * Configurar se sigue haciendo en Notion; acá sólo se marca y se consulta.
 */
export function TasksPanel({ clientId, isAdmin, currentUserId }: { clientId: string; isAdmin: boolean; currentUserId?: string }) {
  const [board, setBoard] = useState<TaskBoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<TeamTask | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showOthers, setShowOthers] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTaskBoard(clientId)
      .then(async (data) => {
        if (cancelled) return
        setBoard(data)
        const stale = data.config.connected && (!data.config.syncedAt || Date.now() - new Date(data.config.syncedAt).getTime() > STALE_MS)
        if (!stale || autoSyncFallido.has(clientId)) return
        const result = await syncNotionTasksAction(clientId).catch(() => ({ success: false as const, error: '' }))
        if (!result.success) {
          autoSyncFallido.add(clientId)
          return
        }
        if (cancelled) return
        const fresh = await getTaskBoard(clientId)
        if (!cancelled) setBoard(fresh)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Error inesperado'))
    return () => {
      cancelled = true
    }
  }, [clientId])

  async function resync() {
    setSyncing(true)
    const result = await syncNotionTasksAction(clientId).catch((e) => ({
      success: false as const,
      error: e instanceof Error ? e.message : 'Error inesperado',
    }))
    if (result.success) {
      autoSyncFallido.delete(clientId)
      setBoard(await getTaskBoard(clientId))
    } else {
      autoSyncFallido.add(clientId)
      setError(result.error)
    }
    setSyncing(false)
  }

  function removeTask(taskId: string) {
    setBoard((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) } : prev))
  }

  function applyChange(updated: TeamTask) {
    setBoard((prev) => (prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev))
    setOpenTask((prev) => (prev?.id === updated.id ? updated : prev))
  }

  const mine = useMemo(() => (board?.tasks ?? []).filter((t) => !t.is_stage && esMia(t, currentUserId) && t.status !== 'hecha'), [board, currentUserId])

  // La etapa en curso: contexto del lanzamiento, no una tarea de nadie.
  const etapa = useMemo(() => etapaActual(soloEtapas(board?.tasks ?? [])), [board])
  const overdueCount = mine.filter(isOverdue).length

  // Agrupado por responsable para la vista de admin. Las tareas cuyo
  // responsable en Notion no matchea con nadie del CRM quedan igual visibles
  // bajo su nombre de Notion, para que no desaparezcan sin que nadie se entere.
  const byPerson = useMemo(() => {
    const map = new Map<string, TeamTask[]>()
    for (const t of board?.tasks ?? []) {
      if (t.status === 'hecha' || t.is_stage) continue
      const key = t.assignee_name ?? 'Sin responsable'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    // Cada persona ve primero lo vencido y lo de hoy, no el orden en que
    // Notion devolvió las páginas.
    for (const items of map.values()) items.sort(byUrgency)
    return [...map.entries()].sort(([a], [b]) => (a === 'Sin responsable' ? 1 : b === 'Sin responsable' ? -1 : a.localeCompare(b)))
  }, [board])

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  if (!board) return <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Cargando tareas…</div>

  if (board.config.needsMigration) {
    return (
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/15 py-10 text-center">
        <p className="text-sm text-amber-300">Falta correr la migración de la base de datos.</p>
        <p className="mt-1 text-xs text-amber-200/70">
          Ejecuta <code className="rounded bg-amber-950/40 px-1">supabase/036-team-tasks.sql</code> en Supabase y recarga la página.
        </p>
      </div>
    )
  }

  if (!board.config.connected) {
    return (
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] py-14 text-center">
        <p className="text-sm text-zinc-400">Todavía no hay un tablero de tareas conectado.</p>
        {isAdmin && (
          <Link
            href={`/clients/${clientId}/tareas`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
          >
            Conectar Notion <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    )
  }

  const others = board.tasks.filter((t) => !t.is_stage && t.status !== 'hecha' && !esMia(t, currentUserId))

  const edit: TaskEditContext = {
    canEdit: isAdmin,
    assigneeEditable: board.config.assigneeEditable,
    options: board.config.options,
  }

  return (
    <div className="space-y-5">
      {/* En qué parte del lanzamiento están. Va antes que los pendientes
          porque enmarca todo lo que viene abajo. */}
      {etapa && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-2.5">
          <Layers className="h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400/70">Etapa actual</span>
          <span className="truncate text-sm font-semibold uppercase tracking-wide text-violet-100">{etapa.title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-violet-300/70">{formatRange(etapa)}</span>
        </div>
      )}

      {/* Aviso de pendientes propios — es lo primero que ve cada miembro */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
          mine.length === 0
            ? 'border-emerald-900/30 bg-emerald-950/15'
            : overdueCount > 0
              ? 'border-red-900/40 bg-red-950/20'
              : 'border-amber-900/30 bg-amber-950/15'
        )}
      >
        {mine.length === 0 ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-sm text-emerald-300">No tienes tareas pendientes.</p>
          </>
        ) : (
          <>
            <Bell className={cn('h-4 w-4 shrink-0', overdueCount > 0 ? 'text-red-400' : 'text-amber-400')} />
            <p className={cn('text-sm', overdueCount > 0 ? 'text-red-300' : 'text-amber-300')}>
              Tienes <span className="font-semibold">{mine.length}</span> {mine.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}
              {overdueCount > 0 && <> · {overdueCount} vencida{overdueCount > 1 ? 's' : ''}</>}
            </p>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Nueva tarea</span>
            </button>
          )}
          <button
            onClick={resync}
            disabled={syncing}
            title="Traer los últimos cambios de Notion"
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            <span className="hidden sm:inline">Sincronizar</span>
          </button>
          <Link
            href={`/clients/${clientId}/tareas`}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
          >
            Ver tablero <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Mis tareas */}
      {mine.length > 0 && (
        <div>
          <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Mis tareas</h3>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-1">
            {mine.map((t) => (
              <TaskRow key={t.id} task={t} clientId={clientId} canCheck showAssignee={false} onChanged={applyChange} onOpen={setOpenTask} />
            ))}
          </div>
        </div>
      )}

      {/* Admin: todo el equipo, repartido por responsable */}
      {isAdmin ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {byPerson.map(([name, items]) => (
            <div key={name} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-1">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium', personColor(name))}>
                  {initials(name)}
                </span>
                <h3 className="flex-1 truncate text-sm text-zinc-300">{name}</h3>
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{items.length}</span>
              </div>
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  clientId={clientId}
                  canCheck
                  showAssignee={false}
                  onChanged={applyChange}
                  onOpen={setOpenTask}
                />
              ))}
            </div>
          ))}
          {byPerson.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-zinc-600">No queda nada pendiente en el tablero.</p>
          )}
        </div>
      ) : (
        others.length > 0 && (
          <div>
            <button
              onClick={() => setShowOthers((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !showOthers && '-rotate-90')} />
              Del resto del equipo ({others.length})
            </button>
            {showOthers && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-1">
                {others.map((t) => (
                  <TaskRow key={t.id} task={t} clientId={clientId} canCheck={false} onChanged={applyChange} onOpen={setOpenTask} />
                ))}
              </div>
            )}
          </div>
        )
      )}

      {openTask && (
        <TaskDetailDrawer
          key={openTask.id}
          task={openTask}
          clientId={clientId}
          canCheck={isAdmin || openTask.assigned_to === currentUserId}
          edit={edit}
          onClose={() => setOpenTask(null)}
          onChanged={applyChange}
          onDeleted={removeTask}
        />
      )}

      {creating && (
        <NewTaskModal
          clientId={clientId}
          edit={edit}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void resync()
          }}
        />
      )}
    </div>
  )
}
