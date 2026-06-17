'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateLeadStageAction } from '@/lib/actions/leads'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'
import type { LeadStage } from '@/lib/types'

interface LeadWithRelations {
  id: string
  client_id: string
  ig_username: string | null
  full_name: string | null
  stage: LeadStage
  assigned_to: string | null
  close_value: number | null
  days_to_close: number | null
  first_touch_type: string | null
  created_at: string
  clients: { name: string; ig_handle: string } | null
  users: { full_name: string } | null
}

const stages: { id: LeadStage; label: string; color: string }[] = [
  { id: 'new', label: 'Nuevo', color: 'text-zinc-400' },
  { id: 'contacted', label: 'Contactado', color: 'text-blue-400' },
  { id: 'agenda_set', label: 'Agendado', color: 'text-amber-400' },
  { id: 'showed_up', label: 'Asistió', color: 'text-emerald-400' },
  { id: 'no_show', label: 'No Show', color: 'text-red-400' },
  { id: 'closed_won', label: 'Cerrado', color: 'text-emerald-300' },
  { id: 'closed_lost', label: 'Perdido', color: 'text-red-300' },
]

export function LeadsPipeline({ leads, filterClient }: { leads: LeadWithRelations[]; filterClient: string }) {
  const router = useRouter()
  const [moving, setMoving] = useState<string | null>(null)

  const filtered = filterClient ? leads.filter((l) => l.client_id === filterClient) : leads

  async function moveStage(leadId: string, newStage: LeadStage) {
    setMoving(leadId)
    await updateLeadStageAction(leadId, newStage)
    router.refresh()
    setMoving(null)
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-7">
      {stages.map((stage) => {
        const stageLeads = filtered.filter((l) => l.stage === stage.id)
        return (
          <div key={stage.id} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className={`text-xs font-medium uppercase tracking-wider ${stage.color}`}>
                {stage.label}
              </h3>
              <span className="text-xs text-zinc-600">{stageLeads.length}</span>
            </div>
            <div className="space-y-2 min-h-[120px]">
              {stageLeads.map((lead) => (
                <Card key={lead.id} className={`p-3 space-y-2 ${moving === lead.id ? 'opacity-50' : ''}`}>
                  <p className="text-sm font-medium text-zinc-100 truncate">
                    {lead.full_name || lead.ig_username || 'Sin nombre'}
                  </p>
                  {lead.ig_username && (
                    <p className="text-xs text-zinc-500">{lead.ig_username}</p>
                  )}
                  <p className="text-xs text-zinc-500">{lead.clients?.ig_handle}</p>
                  {lead.users && (
                    <Badge variant="default">{lead.users.full_name}</Badge>
                  )}
                  {lead.days_to_close && (
                    <p className="text-xs text-emerald-400">
                      {lead.days_to_close.toFixed(1)} días
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {stages
                      .filter((s) => s.id !== lead.stage)
                      .slice(0, 3)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => moveStage(lead.id, s.id)}
                          disabled={moving === lead.id}
                          className={`text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 ${s.color} transition-colors`}
                        >
                          → {s.label}
                        </button>
                      ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
