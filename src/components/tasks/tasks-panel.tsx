'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ArrowUpRight, Bell, CheckCircle2, ChevronDown, AlertTriangle, Plus, Layers } from 'lucide-react'
import { getTaskBoard, syncNotionTasksAction, type TaskBoardData } from '@/lib/actions/tasks'
import type { TeamTask } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  TaskRow, TaskDetailDrawer, isOverdue, byUrgency, soloEtapas, etapaActual, formatRange, esMia,
  dentroDelHorizonte, agruparPorUrgencia, HORIZON_LABEL, URGENCIA_LABEL, URGENCIA_SECTION_BORDER,
  personColor, initials, type TaskEditContext, type Horizon,
} from './task-ui'
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
  // Por defecto sólo "esta semana": con 14+ tareas visibles de una, la lista
  // se vuelve ruido y todo pesa igual. Vencidas y en curso nunca se ocultan
  // (ver dentroDelHorizonte) — el horizonte recorta lo que todavía no empieza.
  const [horizon, setHorizon] = useState<Horizon>(7)

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

  // Ordenadas por urgencia efectiva —vencido y hoy primero, y una prioridad
  // alta puede adelantar un tramo (ver byUrgency)— no por la fecha cruda: eso
  // es lo que hace que "la prioridad avance según la fecha" sea visible y no
  // sólo un dato guardado que nadie ve reflejado en el orden.
  const mineAll = useMemo(
    () => (board?.tasks ?? []).filter((t) => !t.is_stage && esMia(t, currentUserId) && t.status !== 'hecha').sort(byUrgency),
    [board, currentUserId]
  )
  const mine = useMemo(() => mineAll.filter((t) => dentroDelHorizonte(t, horizon)), [mineAll, horizon])
  const mineOcultas = mineAll.length - mine.length
  const mineGrupos = useMemo(() => agruparPorUrgencia(mine), [mine])

  // La etapa en curso: contexto del lanzamiento, no una tarea de nadie.
  const etapa = useMemo(() => etapaActual(soloEtapas(board?.tasks ?? [])), [board])
  // El aviso de arriba ("Tienes N pendientes") cuenta TODO lo propio, no sólo
  // lo que entra en el horizonte — que el filtro achique la lista visible no
  // debe achicar cuánto falta por hacer en total.
  const overdueCount = mineAll.filter(isOverdue).length

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
    // Notion devolvió las páginas. El mismo horizonte de "Mis tareas" recorta
    // acá también, para que el panel entero respire igual de liviano. Se
    // guarda el total sin filtrar para no confundir "sin nada esta semana"
    // con "no queda nada pendiente".
    return [...map.entries()]
      .map(([name, all]) => {
        const sorted = all.sort(byUrgency)
        return { name, total: sorted.length, items: sorted.filter((t) => dentroDelHorizonte(t, horizon)) }
      })
      .filter((p) => p.items.length > 0)
      .sort((a, b) => (a.name === 'Sin responsable' ? 1 : b.name === 'Sin responsable' ? -1 : a.name.localeCompare(b.name)))
  }, [board, horizon])

  // Si el tablero tiene tareas pendientes pero ninguna cae dentro del
  // horizonte, byPerson queda vacío por el filtro — y eso no es lo mismo que
  // "no queda nada pendiente". El mensaje de abajo distingue los dos casos.
  const totalPendientesEquipo = useMemo(
    () => (board?.tasks ?? []).filter((t) => t.status !== 'hecha' && !t.is_stage).length,
    [board]
  )

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

  const others = board.tasks
    .filter((t) => !t.is_stage && t.status !== 'hecha' && !esMia(t, currentUserId))
    .sort(byUrgency)
    .filter((t) => dentroDelHorizonte(t, horizon))

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

      {/* Aviso de pendientes propios — es lo primero que ve cada miembro.
          Cuenta mineAll (el total real), NO mine (que es lo que entra en el
          horizonte elegido). Contar `mine` acá era el bug: con el horizonte
          en "Esta semana" mostraba "No tienes tareas pendientes" al mismo
          tiempo que el bloque de abajo decía "Mis tareas (0 de 14)" —dos
          verdades contradictorias sobre la misma pantalla. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
          mineAll.length === 0
            ? 'border-emerald-900/30 bg-emerald-950/15'
            : overdueCount > 0
              ? 'border-red-900/40 bg-red-950/20'
              : 'border-amber-900/30 bg-amber-950/15'
        )}
      >
        {mineAll.length === 0 ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-sm text-emerald-300">No tienes tareas pendientes.</p>
          </>
        ) : (
          <>
            <Bell className={cn('h-4 w-4 shrink-0', overdueCount > 0 ? 'text-red-400' : 'text-amber-400')} />
            <p className={cn('text-sm', overdueCount > 0 ? 'text-red-300' : 'text-amber-300')}>
              Tienes <span className="font-semibold">{mineAll.length}</span> {mineAll.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}
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

      {/* Mis tareas — recortadas al horizonte elegido y agrupadas por urgencia,
          para que abrir el CRM no sea toparse con 14 tareas del mismo peso de
          una sola vez. Vencidas y en curso están siempre, sin importar el
          horizonte (dentroDelHorizonte). */}
      {mineAll.length > 0 && (
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Mis tareas {mine.length !== mineAll.length && <span className="text-zinc-600">({mine.length} de {mineAll.length})</span>}
            </h3>
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
              {([7, 14, 30] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    horizon === h ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {HORIZON_LABEL[h]}
                </button>
              ))}
            </div>
          </div>

          {mine.length === 0 ? (
            <p className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-6 text-center text-xs text-zinc-600">
              Nada para {HORIZON_LABEL[horizon].toLowerCase()} — tienes {mineAll.length} tarea{mineAll.length === 1 ? '' : 's'} más adelante.
            </p>
          ) : (
            <div className="space-y-3">
              {mineGrupos.map((g) => (
                <div
                  key={g.urgencia}
                  className={cn('overflow-hidden rounded-xl border bg-white/[0.02] p-1', URGENCIA_SECTION_BORDER[g.urgencia])}
                >
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    {URGENCIA_LABEL[g.urgencia]} <span className="text-zinc-700">· {g.items.length}</span>
                  </p>
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} clientId={clientId} canCheck showAssignee={false} onChanged={applyChange} onOpen={setOpenTask} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {mineOcultas > 0 && mine.length > 0 && (
            <p className="mt-1.5 px-3 text-[11px] text-zinc-600">
              +{mineOcultas} tarea{mineOcultas === 1 ? '' : 's'} más allá de {HORIZON_LABEL[horizon].toLowerCase()}.
            </p>
          )}
        </div>
      )}

      {/* Admin: todo el equipo, repartido por responsable */}
      {isAdmin ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {byPerson.map(({ name, items, total }) => (
            <div key={name} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-1">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium', personColor(name))}>
                  {initials(name)}
                </span>
                <h3 className="flex-1 truncate text-sm text-zinc-300">{name}</h3>
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  {items.length}{items.length !== total && <span className="text-zinc-600"> / {total}</span>}
                </span>
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
            <p className="col-span-full py-10 text-center text-sm text-zinc-600">
              {totalPendientesEquipo === 0
                ? 'No queda nada pendiente en el tablero.'
                : `Nada para ${HORIZON_LABEL[horizon].toLowerCase()} — hay ${totalPendientesEquipo} tarea${totalPendientesEquipo === 1 ? '' : 's'} más adelante.`}
            </p>
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
