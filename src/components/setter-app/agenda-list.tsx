'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { updateAgendaRecord } from '@/lib/actions/agenda-records'
import type { SetterAgendaRow } from '@/lib/actions/setter-app'
import { formatDate } from '@/lib/utils'

const AGENDA_ESTADOS = ['Pendiente', 'Show', 'No Show', 'No Cerrado', 'Cerrado', 'No Calificado'] as const

const ESTADO_COLOR: Record<string, string> = {
  Pendiente: 'text-amber-300',
  Show: 'text-emerald-400',
  'No Show': 'text-red-400',
  'No Cerrado': 'text-zinc-400',
  Cerrado: 'text-emerald-400',
  'No Calificado': 'text-red-400',
}

interface Props {
  agendas: SetterAgendaRow[]
}

export function AgendaList({ agendas: initial }: Props) {
  const [agendas, setAgendas] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleEstado(id: string, estado: string) {
    setOpenId(null)
    setError(null)
    setPendingId(id)
    const previous = agendas
    setAgendas((cur) => cur.map((a) => (a.id === id ? { ...a, estado } : a)))
    try {
      await updateAgendaRecord(id, { estado })
    } catch {
      setAgendas(previous)
      setError('No se pudo actualizar — intenta de nuevo')
    } finally {
      setPendingId(null)
    }
  }

  if (agendas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-lg font-medium text-zinc-300">Sin agendas</p>
        <p className="mt-1 text-sm text-zinc-500">No hay llamadas agendadas todavía.</p>
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
      {agendas.map((a) => (
        <div
          key={a.id}
          className={`rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_20px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-opacity ${pendingId === a.id ? 'opacity-50' : ''}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">{a.nombreLead || 'Sin nombre'}</p>
              {a.deDondeVino && <p className="truncate text-xs text-zinc-500">{a.deDondeVino}</p>}
            </div>
            <button
              onClick={() => setOpenId(a.id)}
              className={`shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium ${ESTADO_COLOR[a.estado ?? ''] ?? 'text-zinc-400'}`}
            >
              {a.estado ?? 'Pendiente'}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {a.fechaAgenda ? formatDate(a.fechaAgenda) : 'Sin fecha'}
          </p>
        </div>
      ))}

      <Dialog open={!!openId} onClose={() => setOpenId(null)} title="Resultado de la llamada">
        <div className="space-y-1">
          {AGENDA_ESTADOS.map((estado) => (
            <button
              key={estado}
              onClick={() => openId && handleEstado(openId, estado)}
              className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/[0.04]"
            >
              <span className={ESTADO_COLOR[estado]}>{estado}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}
