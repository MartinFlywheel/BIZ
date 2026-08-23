'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { LeadCard } from './lead-card'
import { updateLeadStageAction } from '@/lib/actions/leads'
import { getMyActiveLeads, type SetterLeadCard } from '@/lib/actions/setter-app'
import type { LeadStage } from '@/lib/types'

const TERMINAL: LeadStage[] = ['no_calificado', 'cierre']

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
  stage: LeadStage
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
  const [, startTransition] = useTransition()

  // Instant feedback the moment a setter taps a stage button — the actual
  // DB write (and the agenda-record side effect for 'agendado') happens
  // behind it. If it fails, `leads` (the real state) never moves, so once
  // the transition settles React reverts the optimistic value back on its
  // own — the card visibly snaps back instead of lying about what happened.
  const [optimisticLeads, applyOptimistic] = useOptimistic(leads, applyStageChange)

  function handleChangeStage(id: string, stage: LeadStage) {
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      applyOptimistic({ id, stage })
      try {
        const { agendaError } = await updateLeadStageAction(id, stage)
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

  async function loadMore() {
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await getMyActiveLeads(clientId, setterId, nextPage)
      setLeads((prev) => [...prev, ...result.leads])
      setHasMore(result.hasMore)
      setPage(nextPage)
    } catch {
      setError('No se pudo cargar más leads — intenta de nuevo')
    } finally {
      setLoadingMore(false)
    }
  }

  if (optimisticLeads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-lg font-medium text-zinc-300">Todo al día 🎉</p>
        <p className="mt-1 text-sm text-zinc-500">No hay leads activos pendientes en este momento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-4 pb-10">
      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
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
    </div>
  )
}
