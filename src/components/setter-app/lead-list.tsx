'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { LeadCard } from './lead-card'
import { updateLeadStageAction } from '@/lib/actions/leads'
import { getMyActiveLeads, type SetterLeadCard, type LeadFilters } from '@/lib/actions/setter-app'
import { LEAD_STAGES } from '@/lib/types'
import { Search } from 'lucide-react'

const TERMINAL: string[] = ['no_calificado', 'cierre']

interface Props {
  clientId: string
  // null = admin oversight view (every setter's active leads for this
  // client), not just one person's caseload.
  setterId: string | null
  initialLeads: SetterLeadCard[]
  initialHasMore: boolean
}

interface StageChange {
  id: string
  stage: string
}

function applyStageChange(state: SetterLeadCard[], change: StageChange): SetterLeadCard[] {
  if (TERMINAL.includes(change.stage)) return state.filter((l) => l.id !== change.id)
  return state.map((l) => (l.id === change.id ? { ...l, stage: change.stage } : l))
}

export function LeadList({ clientId, setterId, initialLeads, initialHasMore }: Props) {
  const [leads, setLeads] = useState(initialLeads)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [page, setPage] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('')
  const [filtering, setFiltering] = useState(false)
  const [, startTransition] = useTransition()
  const filterEpoch = useRef(0)

  // Instant feedback the moment a setter taps a stage button — the actual
  // DB write (and the agenda-record side effect for 'agendado') happens
  // behind it. If it fails, `leads` (the real state) never moves, so once
  // the transition settles React reverts the optimistic value back on its
  // own — the card visibly snaps back instead of lying about what happened.
  const [optimisticLeads, applyOptimistic] = useOptimistic(leads, applyStageChange)

  function handleChangeStage(id: string, stage: string, agendaDate?: string) {
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      applyOptimistic({ id, stage })
      try {
        const { agendaError } = await updateLeadStageAction(id, stage, agendaDate)
        setLeads((prev) => applyStageChange(prev, { id, stage }))
        if (agendaError) {
          setError(`Se movió a "${stage}", pero no se pudo crear el registro en Agendas: ${agendaError}`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar el lead — intenta de nuevo')
      } finally {
        setPendingId(null)
      }
    })
  }

  // Debounced re-fetch from page 0 whenever search or stage filter changes.
  // filterEpoch guards against an older, slower request landing after a
  // newer one and clobbering its (more current) result.
  useEffect(() => {
    const epoch = ++filterEpoch.current
    const filters: LeadFilters = { search: search || undefined, stage: stageFilter || undefined }
    const isFirstRun = !search && !stageFilter
    const delay = isFirstRun ? 0 : 350

    const timer = setTimeout(async () => {
      if (isFirstRun) return
      setFiltering(true)
      try {
        const result = await getMyActiveLeads(clientId, setterId, 0, filters)
        if (filterEpoch.current !== epoch) return
        setLeads(result.leads)
        setHasMore(result.hasMore)
        setPage(0)
      } catch {
        if (filterEpoch.current === epoch) setError('No se pudo buscar — intenta de nuevo')
      } finally {
        if (filterEpoch.current === epoch) setFiltering(false)
      }
    }, delay)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, stageFilter, clientId, setterId])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const filters: LeadFilters = { search: search || undefined, stage: stageFilter || undefined }
      const result = await getMyActiveLeads(clientId, setterId, nextPage, filters)
      setLeads((prev) => [...prev, ...result.leads])
      setHasMore(result.hasMore)
      setPage(nextPage)
    } catch {
      setError('No se pudo cargar más leads — intenta de nuevo')
    } finally {
      setLoadingMore(false)
    }
  }

  const isFiltered = !!search || !!stageFilter

  return (
    <div className="space-y-3 px-4 pb-10">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o usuario..."
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-zinc-300"
        >
          <option value="">Todas las etapas activas</option>
          {LEAD_STAGES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {filtering ? (
        <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Buscando...</div>
      ) : optimisticLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
          {isFiltered ? (
            <>
              <p className="text-lg font-medium text-zinc-300">Sin resultados</p>
              <p className="mt-1 text-sm text-zinc-500">Ningún lead coincide con ese filtro.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-zinc-300">Todo al día 🎉</p>
              <p className="mt-1 text-sm text-zinc-500">No hay leads activos pendientes en este momento.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {optimisticLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onChangeStage={handleChangeStage}
              pending={pendingId === lead.id}
            />
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] py-3 text-sm text-zinc-400 disabled:opacity-50"
            >
              {loadingMore ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
