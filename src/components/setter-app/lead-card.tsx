'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { LEAD_STAGES } from '@/lib/types'
import type { LeadStage } from '@/lib/types'
import type { SetterLeadCard } from '@/lib/actions/setter-app'
import { Calendar, XCircle, CheckCircle2, ArrowRight, ChevronDown, MessageCircle } from 'lucide-react'

const STAGE_LABEL = Object.fromEntries(LEAD_STAGES.map((s) => [s.id, s.label])) as Record<LeadStage, string>
const STAGE_COLOR = Object.fromEntries(LEAD_STAGES.map((s) => [s.id, s.color])) as Record<LeadStage, string>
const STAGE_ORDER = LEAD_STAGES.map((s) => s.id)

// Next step in the normal pipeline flow — except at 'agendado', the fork
// point where the setter records the actual call outcome (won or lost)
// instead of marching further down a fixed sequence.
function nextStage(current: LeadStage): LeadStage | null {
  if (current === 'agendado') return null
  const idx = STAGE_ORDER.indexOf(current)
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null
  return STAGE_ORDER[idx + 1]
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  chat_abierto: 'Chat abierto',
  conversacion_real: 'Conversación real',
  lead_calificado: 'Calificado',
}

interface Props {
  lead: SetterLeadCard
  onChangeStage: (id: string, stage: LeadStage) => void
  pending: boolean
}

export function LeadCard({ lead, onChangeStage, pending }: Props) {
  const [showStages, setShowStages] = useState(false)
  const next = nextStage(lead.stage)
  const isAgendado = lead.stage === 'agendado'

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_20px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-opacity ${pending ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">
            {lead.full_name || lead.ig_username || 'Sin nombre'}
          </p>
          {lead.ig_username && lead.full_name && (
            <p className="truncate text-xs text-zinc-500">@{lead.ig_username}</p>
          )}
          {lead.assignedToName && (
            <p className="truncate text-[11px] text-zinc-600">→ {lead.assignedToName}</p>
          )}
        </div>
        <button
          onClick={() => setShowStages(true)}
          className={`flex shrink-0 items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium ${STAGE_COLOR[lead.stage] ?? 'text-zinc-400'}`}
        >
          {STAGE_LABEL[lead.stage] ?? lead.stage}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
        {lead.classification && (
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            {CLASSIFICATION_LABEL[lead.classification] ?? lead.classification}
          </span>
        )}
        {lead.classification && <span>·</span>}
        <span>hace {timeAgo(lead.updated_at).replace('hace ', '')}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {isAgendado ? (
          <>
            <button
              disabled={pending}
              onClick={() => onChangeStage(lead.id, 'cierre')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 py-3 text-sm font-semibold text-emerald-400 transition-transform active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Cierre
            </button>
            <button
              disabled={pending}
              onClick={() => onChangeStage(lead.id, 'no_calificado')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/15 py-3 text-sm font-semibold text-red-400 transition-transform active:scale-95 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              No calificado
            </button>
          </>
        ) : (
          <>
            {next && (
              <button
                disabled={pending}
                onClick={() => onChangeStage(lead.id, next)}
                className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-white/[0.09] py-3 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-50"
              >
                Avanzar
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              disabled={pending}
              onClick={() => onChangeStage(lead.id, 'agendado')}
              title="Marcar agendado"
              className="flex items-center justify-center rounded-xl bg-amber-500/15 px-4 py-3 text-amber-400 transition-transform active:scale-95 disabled:opacity-50"
            >
              <Calendar className="h-4 w-4" />
            </button>
            <button
              disabled={pending}
              onClick={() => onChangeStage(lead.id, 'no_calificado')}
              title="No calificado"
              className="flex items-center justify-center rounded-xl bg-red-500/10 px-4 py-3 text-red-400/80 transition-transform active:scale-95 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <Dialog open={showStages} onClose={() => setShowStages(false)} title="Cambiar etapa">
        <div className="space-y-1">
          {LEAD_STAGES.map((s) => (
            <button
              key={s.id}
              onClick={() => { onChangeStage(lead.id, s.id); setShowStages(false) }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${
                s.id === lead.stage ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
              }`}
            >
              <span className={s.color}>{s.label}</span>
              {s.id === lead.stage && <span className="text-xs text-zinc-500">Actual</span>}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}
