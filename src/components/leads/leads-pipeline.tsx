'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateLeadStageAction } from '@/lib/actions/leads'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'
import { LEAD_STAGES, type LeadStage } from '@/lib/types'

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

// Mismas etapas que la pestaña CRM del cliente. Antes este tablero tenía
// solo las siete del vocabulario original y no mostraba ningún lead en
// nuevo_contacto, conversando, etc. (ver migración 063).
const stages: { id: LeadStage; label: string; color: string }[] = LEAD_STAGES.map((s) => ({
  id: s.id as LeadStage,
  label: s.label,
  color: s.color,
}))

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
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const stageLeads = filtered.filter((l) => l.stage === stage.id)
        return (
          <div key={stage.id} className="w-56 shrink-0 space-y-3">
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
