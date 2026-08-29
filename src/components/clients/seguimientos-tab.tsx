'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead, ContentPiece, Interaction } from '@/lib/types'
import { LEAD_STAGES } from '@/lib/types'
import { updateLeadStageAction, snoozeLeadAction, markFollowUpDoneAction } from '@/lib/actions/leads'
import { MessageCircle, Search } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { AgencyUser } from './crm-tab'

const stageInfo = (stage: string) => LEAD_STAGES.find(s => s.id === stage)
const stageLabel = (stage: string) => stageInfo(stage)?.label || stage

// Posición de cada etapa en el funnel — usado para priorizar el seguimiento
// desde la etapa más cercana a "Agendado" hacia atrás.
const STAGE_ORDER = new Map(LEAD_STAGES.map((s, i) => [s.id, i]))

const prettifyKey = (key: string) => {
  const withSpaces = key.replace(/_/g, ' ')
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

// Solo entran a la cola los leads con una conversación real ya en curso —
// no "nuevo_contacto" (recién llegados, todavía sin trabajar) ni ninguna
// etapa de cierre/agenda, que tienen sus propias vistas.
const FOLLOWUP_ELIGIBLE_STAGES = new Set<string>(['conversando', 'micro_vsl_enviado', 'vsl_chat', 'calendly_enviado'])

interface Props {
  leads: Lead[]
  contentPieces: ContentPiece[]
  interactions?: Interaction[]
  clientId: string
  agencyUsers: AgencyUser[]
  isAdmin?: boolean
  currentUserId?: string
}

export function SeguimientosTab({ leads, contentPieces, interactions, clientId, agencyUsers, isAdmin = false, currentUserId }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [stageModalLead, setStageModalLead] = useState<Lead | null>(null)
  const [selectedNewStage, setSelectedNewStage] = useState<string>('')
  const [setterFilter, setSetterFilter] = useState('all')

  // Admin puede elegir a quién mirar (o "todos"); un setter viendo su propia
  // cola queda acotado automáticamente a lo suyo, sin selector.
  const effectiveSetterFilter = isAdmin ? setterFilter : (currentUserId || 'all')

  const scopedLeads = useMemo(() => {
    if (effectiveSetterFilter === 'all') return leads
    return leads.filter(l => l.assigned_to === effectiveSetterFilter)
  }, [leads, effectiveSetterFilter])

  // Mismo lookup con fallback que usa el drawer de Leads (crm-tab.tsx):
  // el join del backend solo resuelve por interaction_id, así que un lead
  // cuyo interaction_id esté desactualizado (o nulo, en leads viejos)
  // aparecía sin ficha de calificación aunque sí exista una interacción con
  // esos datos para su ig_username.
  const interactionById = useMemo(() => {
    const m = new Map<string, Interaction>()
    for (const i of interactions ?? []) m.set(i.id, i)
    return m
  }, [interactions])

  const interactionByUsername = useMemo(() => {
    const m = new Map<string, Interaction>()
    for (const i of interactions ?? []) {
      if (!i.ig_username) continue
      const key = i.ig_username.toLowerCase()
      const existing = m.get(key)
      if (!existing || i.updated_at > existing.updated_at) m.set(key, i)
    }
    return m
  }, [interactions])

  function qualificationDataFor(l: Lead): Record<string, unknown> | undefined {
    const match =
      (l.interaction_id && interactionById.get(l.interaction_id)) ||
      (l.ig_username && interactionByUsername.get(l.ig_username.toLowerCase())) ||
      null
    return match?.prequalification_data
  }

  // Filtrar leads para hacer ahora y programados
  const { paraHacerAhora, programados, agendaronHoy } = useMemo(() => {
    const ahora: Lead[] = []
    const prog: Lead[] = []
    const agen: Lead[] = []

    const hoyStr = new Date().toISOString().split('T')[0]
    const startOfToday = new Date(hoyStr + 'T00:00:00.000Z').getTime()
    const now = Date.now()

    for (const lead of scopedLeads) {
      // leads que agendaron hoy (para la estadística de "agendaron")
      // Esto asume que agenda_at o updated_at es hoy y están en etapa agendado
      if ((lead.stage === 'agendado' || lead.stage === 'agenda_set') && lead.updated_at.startsWith(hoyStr)) {
        agen.push(lead)
        continue
      }

      if (!FOLLOWUP_ELIGIBLE_STAGES.has(lead.stage)) continue

      const updatedAt = new Date(lead.updated_at).getTime()
      const nextFollowUp = lead.next_follow_up_date ? new Date(lead.next_follow_up_date).getTime() : null

      // Si tiene fecha programada
      if (nextFollowUp) {
        if (nextFollowUp > now) {
          prog.push(lead)
        } else {
          ahora.push(lead)
        }
      } else {
        // Si no tiene fecha programada, entra a "Para hacer ahora" solo si su última actualización fue antes de HOY (es de ayer o más viejo)
        if (updatedAt < startOfToday) {
          ahora.push(lead)
        }
      }
    }

    // Ordenar los de "ahora" por prioridad de etapa (el más cerca de agendar
    // primero, retrocediendo en el funnel) para que el setter ataque primero
    // los leads más calientes y no se sature viendo todo mezclado. Dentro de
    // una misma etapa, el más urgente (más viejo) va primero.
    ahora.sort((a, b) => {
      const stageDiff = (STAGE_ORDER.get(b.stage) ?? -1) - (STAGE_ORDER.get(a.stage) ?? -1)
      if (stageDiff !== 0) return stageDiff
      const timeA = a.next_follow_up_date ? new Date(a.next_follow_up_date).getTime() : new Date(a.updated_at).getTime()
      const timeB = b.next_follow_up_date ? new Date(b.next_follow_up_date).getTime() : new Date(b.updated_at).getTime()
      return timeA - timeB
    })

    return { paraHacerAhora: ahora, programados: prog, agendaronHoy: agen }
  }, [scopedLeads])

  const filteredAhora = useMemo(() => {
    if (!search) return paraHacerAhora
    const s = search.toLowerCase()
    return paraHacerAhora.filter(l => 
      l.full_name?.toLowerCase().includes(s) || 
      l.ig_username?.toLowerCase().includes(s)
    )
  }, [paraHacerAhora, search])

  const handleAction = (leadId: string, action: 'agendo' | 'perdido') => {
    setPendingId(leadId)
    startTransition(async () => {
      try {
        if (action === 'agendo') {
          // El modal de fecha no lo tenemos acá por simplicidad (usa fecha de hoy como placeholder o abriría el modal real)
          // Para no replicar todo el modal, marcamos agendado directo (se puede editar en Leads)
          await updateLeadStageAction(leadId, 'agendado')
        } else if (action === 'perdido') {
          await snoozeLeadAction(leadId)
        }
      } finally {
        setPendingId(null)
        router.refresh()
      }
    })
  }

  // Confirmación de "Hice seg.": las conversaciones reales duran, así que
  // por defecto el lead se queda en su etapa actual (solo cuenta el touch).
  // Si el setter indica que sí avanzó, ahí sí se cambia de etapa como
  // cualquier otro avance del Kanban.
  const handleConfirmFollowUp = (leadId: string, newStage: string | null) => {
    setStageModalLead(null)
    setPendingId(leadId)
    startTransition(async () => {
      try {
        if (newStage) {
          await updateLeadStageAction(leadId, newStage)
        } else {
          await markFollowUpDoneAction(leadId)
        }
      } finally {
        setPendingId(null)
        router.refresh()
      }
    })
  }

  // Prettify function for custom fields
  const prettifyField = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return '—'
    return String(value).replace(/_/g, ' ')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-white">
          Seguimiento <span className="text-zinc-500 font-normal text-sm ml-2">{paraHacerAhora.length} para hacer ahora - {programados.length} programados - {agendaronHoy.length} agendaron</span>
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por nombre o IG..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          />
        </div>
        {isAdmin && (
          <Select
            value={setterFilter}
            onChange={e => setSetterFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Todos los setters' },
              ...agencyUsers.map(u => ({ value: u.id, label: u.full_name })),
            ]}
            className="w-auto"
          />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredAhora.length === 0 ? (
          <div className="col-span-full py-16 text-center text-sm text-zinc-500">
            Todo al día 🎉 No hay seguimientos pendientes por ahora.
          </div>
        ) : (
          filteredAhora.map(lead => {
            const isPendingAction = pendingId === lead.id || isPending
            const stage = stageInfo(lead.stage)
            const pqData = qualificationDataFor(lead) || {}
            const pqEntries = Object.entries(pqData).filter(([, value]) => typeof value !== 'object')

            return (
              <div 
                key={lead.id} 
                className={`flex flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden transition-opacity ${isPendingAction ? 'opacity-50' : ''}`}
              >
                {/* Header: Seguimiento X badge */}
                {lead.follow_up_count > 0 && (
                  <div className="bg-amber-500/10 px-4 py-2 border-b border-white/[0.04]">
                    <p className="text-xs font-semibold text-amber-400">Seguimiento {lead.follow_up_count}</p>
                  </div>
                )}
                
                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        {lead.full_name || 'Sin nombre'}
                        <span className="h-2 w-2 rounded-full bg-emerald-500" title="Activo"></span>
                      </h3>
                      {lead.ig_username && (
                        <p className="text-xs text-zinc-500 mt-0.5">@{lead.ig_username}</p>
                      )}
                    </div>
                  </div>

                  {/* Datos de contacto rápidos */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {lead.phone && (
                      <div className="rounded-lg bg-zinc-900/50 px-2 py-1.5 border border-white/[0.04] text-zinc-400 truncate">
                        {lead.phone}
                      </div>
                    )}
                    {lead.ig_username && (
                      <a
                        href={`https://ig.me/m/${lead.ig_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-violet-500/10 text-violet-400 px-2 py-1.5 border border-violet-500/20 text-center hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-1"
                      >
                        <MessageCircle className="h-3 w-3" /> IG DM
                      </a>
                    )}
                    <span className={`rounded-lg bg-white/[0.03] px-2 py-1.5 border border-white/[0.06] font-medium truncate ${stage?.color || 'text-zinc-400'}`}>
                      {stage?.label || lead.stage}
                    </span>
                  </div>

                  {/* Ficha de calificación */}
                  <div className="rounded-xl border border-white/[0.04] bg-zinc-950/50 p-3 space-y-2 mt-2 flex-1 text-[11px]">
                    {pqEntries.length === 0 ? (
                      <p className="text-zinc-600 italic">Sin datos de calificación</p>
                    ) : (
                      pqEntries.map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <span className="text-zinc-500 shrink-0">{prettifyKey(key)}:</span>
                          <span className="text-zinc-300 font-medium truncate">{prettifyField(key, value)}</span>
                        </div>
                      ))
                    )}
                  </div>
                  
                  {/* Footer data */}
                  <div className="text-[10px] text-zinc-600">
                    Última act.: {new Date(lead.updated_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 divide-x divide-white/[0.04] border-t border-white/[0.06] bg-zinc-900">
                  <button
                    disabled={isPendingAction}
                    onClick={() => { setSelectedNewStage(''); setStageModalLead(lead) }}
                    className="py-3 text-xs font-medium text-white hover:bg-white/[0.04] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    Hice seg.
                  </button>
                  <button 
                    disabled={isPendingAction}
                    onClick={() => handleAction(lead.id, 'agendo')}
                    className="py-3 text-xs font-medium text-emerald-400 hover:bg-white/[0.04] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    Agendó
                  </button>
                  <button 
                    disabled={isPendingAction}
                    onClick={() => handleAction(lead.id, 'perdido')}
                    className="py-3 text-xs font-medium text-red-400 hover:bg-white/[0.04] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    Perdido
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {stageModalLead && (
        <Dialog
          open
          onClose={() => setStageModalLead(null)}
          title="¿Cómo sigue este lead?"
          description={stageModalLead.full_name || 'Sin nombre'}
          className="max-w-sm"
        >
          <p className="text-sm text-zinc-400 mb-4">
            Etapa actual: <span className="text-zinc-200 font-medium">{stageLabel(stageModalLead.stage)}</span>
          </p>

          <Button
            type="button"
            onClick={() => handleConfirmFollowUp(stageModalLead.id, null)}
            className="w-full mb-5"
          >
            Se mantiene en {stageLabel(stageModalLead.stage)}
          </Button>

          <div className="border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-500 mb-2">O si la conversación avanzó a otra etapa:</p>
            <div className="flex gap-2">
              <Select
                value={selectedNewStage}
                onChange={e => setSelectedNewStage(e.target.value)}
                placeholder="Elegir etapa..."
                options={LEAD_STAGES.filter(s => s.id !== stageModalLead.stage).map(s => ({ value: s.id, label: s.label }))}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!selectedNewStage}
                onClick={() => selectedNewStage && handleConfirmFollowUp(stageModalLead.id, selectedNewStage)}
              >
                Cambiar
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
