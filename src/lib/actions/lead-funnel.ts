'use server'

import { createClient } from '@/lib/supabase/server'

// =====================================================
// Funnel computed from leads — single source of truth
// No manual metric loading needed. Setters manage leads,
// the funnel auto-updates.
// =====================================================

export interface LeadFunnelStage {
  id: string
  label: string
  count: number
}

export interface ContentFunnel {
  content_id: string
  caption: string | null
  keyword_trigger: string | null
  content_type: string
  stages: LeadFunnelStage[]
  total_leads: number
  cierres: number
  revenue: number
}

export interface ClientFunnelAggregate {
  total_leads: number
  by_stage: LeadFunnelStage[]
  total_cierres: number
  total_revenue: number
  by_content: ContentFunnel[]
}

const STAGE_ORDER = [
  { id: 'nuevo_contacto', label: 'Nuevo Contacto' },
  { id: 'seguimiento', label: 'Seguimiento' },
  { id: 'conversando', label: 'Conversando' },
  { id: 'micro_vsl_enviado', label: 'Micro VSL Enviado' },
  { id: 'vsl_chat', label: 'VSL Chat' },
  { id: 'pitcheado', label: 'Pitcheado' },
  { id: 'calendly_enviado', label: 'Calendly Enviado' },
  { id: 'seguimiento_1', label: 'Seguimiento 1' },
  { id: 'seguimiento_2', label: 'Seguimiento 2' },
  { id: 'propuesta_enviada', label: 'Propuesta Enviada' },
  { id: 'agendado', label: 'Agendado' },
  { id: 'no_calificado', label: 'No Calificado' },
  { id: 'cierre', label: 'Cierre' },
]

export async function getClientLeadFunnel(clientId: string): Promise<ClientFunnelAggregate> {
  const supabase = await createClient()

  const { data: leads } = await supabase
    .from('leads')
    .select('id, stage, close_value, content_id')
    .eq('client_id', clientId)

  if (!leads || leads.length === 0) {
    return {
      total_leads: 0,
      by_stage: STAGE_ORDER.map((s) => ({ ...s, count: 0 })),
      total_cierres: 0,
      total_revenue: 0,
      by_content: [],
    }
  }

  // Count by stage
  const stageCounts = new Map<string, number>()
  for (const s of STAGE_ORDER) stageCounts.set(s.id, 0)

  let totalCierres = 0
  let totalRevenue = 0

  for (const lead of leads) {
    const current = stageCounts.get(lead.stage) || 0
    stageCounts.set(lead.stage, current + 1)

    if (lead.stage === 'cierre' || lead.stage === 'closed_won' || lead.stage === 'cliente') {
      totalCierres++
      totalRevenue += lead.close_value || 0
    }
  }

  const byStage = STAGE_ORDER.map((s) => ({
    ...s,
    count: stageCounts.get(s.id) || 0,
  }))

  // Group by content piece
  const contentMap = new Map<string, { leads: typeof leads }>()
  for (const lead of leads) {
    if (!lead.content_id) continue
    const existing = contentMap.get(lead.content_id)
    if (existing) {
      existing.leads.push(lead)
    } else {
      contentMap.set(lead.content_id, { leads: [lead] })
    }
  }

  const byContent: ContentFunnel[] = []

  if (contentMap.size > 0) {
    const contentIds = Array.from(contentMap.keys())
    const { data: contentPieces } = await supabase
      .from('content_pieces')
      .select('id, caption, keyword_trigger, content_type')
      .in('id', contentIds)

    for (const cp of contentPieces || []) {
      const group = contentMap.get(cp.id)
      if (!group) continue

      const contentStageCounts = new Map<string, number>()
      for (const s of STAGE_ORDER) contentStageCounts.set(s.id, 0)

      let contentCierres = 0
      let contentRevenue = 0

      for (const lead of group.leads) {
        const c = contentStageCounts.get(lead.stage) || 0
        contentStageCounts.set(lead.stage, c + 1)
        if (lead.stage === 'cierre' || lead.stage === 'closed_won' || lead.stage === 'cliente') {
          contentCierres++
          contentRevenue += lead.close_value || 0
        }
      }

      byContent.push({
        content_id: cp.id,
        caption: cp.caption,
        keyword_trigger: cp.keyword_trigger,
        content_type: cp.content_type,
        stages: STAGE_ORDER.map((s) => ({
          ...s,
          count: contentStageCounts.get(s.id) || 0,
        })),
        total_leads: group.leads.length,
        cierres: contentCierres,
        revenue: contentRevenue,
      })
    }
  }

  return {
    total_leads: leads.length,
    by_stage: byStage,
    total_cierres: totalCierres,
    total_revenue: totalRevenue,
    by_content: byContent,
  }
}
