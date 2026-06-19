'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getContentMetrics(contentId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_metrics')
    .select('*')
    .eq('content_id', contentId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getClientContentMetrics(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_metrics')
    .select('*, content_pieces(content_type, caption, ig_permalink, published_at, ig_thumbnail_url)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function upsertContentMetrics(formData: FormData) {
  const supabase = await createClient()
  const contentId = formData.get('content_id') as string
  const clientId = formData.get('client_id') as string

  const { error } = await supabase
    .from('content_metrics')
    .upsert({
      content_id: contentId,
      client_id: clientId,
      views: parseInt(formData.get('views') as string) || 0,
      chats_nuevos: parseInt(formData.get('chats_nuevos') as string) || 0,
      conversaciones_nuevas: parseInt(formData.get('conversaciones_nuevas') as string) || 0,
      agendas: parseInt(formData.get('agendas') as string) || 0,
      shows: parseInt(formData.get('shows') as string) || 0,
      cierres: parseInt(formData.get('cierres') as string) || 0,
      ticket: parseFloat(formData.get('ticket') as string) || 0,
      aov: parseFloat(formData.get('aov') as string) || 0,
      cash_collected: parseFloat(formData.get('cash_collected') as string) || 0,
      manychat_label: (formData.get('manychat_label') as string) || null,
      notes: (formData.get('notes') as string) || null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'content_id',
    })

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
}

// =====================================================
// Funnel calculation per content piece
// =====================================================

interface ContentFunnelStage {
  id: string
  label: string
  value: number
  rate: number
  benchmark_min: number
  status: 'healthy' | 'critical'
  is_bottleneck: boolean
}

export interface ContentFunnelResult {
  stages: ContentFunnelStage[]
  bottleneck: string | null
  cash_collected: number
  ticket: number
  aov: number
}

export async function calculateContentFunnel(contentId: string): Promise<ContentFunnelResult | null> {
  const metrics = await getContentMetrics(contentId)
  if (!metrics) return null

  const { views, chats_nuevos, conversaciones_nuevas, agendas, shows, cierres } = metrics

  function safeRate(num: number, den: number): number {
    return den > 0 ? (num / den) * 100 : 0
  }

  const stagesDef = [
    { id: 'respuesta', label: 'Tasa de Respuesta', value: views, rate: safeRate(chats_nuevos, views), min: 1 },
    { id: 'conversion', label: 'Tasa de Conversión', value: chats_nuevos, rate: safeRate(conversaciones_nuevas, chats_nuevos), min: 70 },
    { id: 'agendamiento', label: 'Tasa de Agendamiento', value: conversaciones_nuevas, rate: safeRate(agendas, conversaciones_nuevas), min: 8 },
    { id: 'show_up', label: 'Show-up Rate', value: agendas, rate: safeRate(shows, agendas), min: 70 },
    { id: 'cierre', label: 'Close Rate', value: shows, rate: safeRate(cierres, shows), min: 30 },
  ]

  let worstDrop = 0
  let bottleneckId: string | null = null

  for (const s of stagesDef) {
    if (s.rate < s.min) {
      const drop = s.min - s.rate
      if (drop > worstDrop) {
        worstDrop = drop
        bottleneckId = s.id
      }
    }
  }

  const stages: ContentFunnelStage[] = stagesDef.map((s) => ({
    id: s.id,
    label: s.label,
    value: s.value,
    rate: Math.round(s.rate * 100) / 100,
    benchmark_min: s.min,
    status: s.rate >= s.min ? 'healthy' : 'critical',
    is_bottleneck: s.id === bottleneckId,
  }))

  return {
    stages,
    bottleneck: bottleneckId,
    cash_collected: metrics.cash_collected,
    ticket: metrics.ticket,
    aov: metrics.aov,
  }
}

// =====================================================
// Aggregate funnel across all content for a client
// =====================================================

export async function calculateClientAggregateFunnel(clientId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('content_metrics')
    .select('views, chats_nuevos, conversaciones_nuevas, agendas, shows, cierres, cash_collected')
    .eq('client_id', clientId)

  if (!data || data.length === 0) return null

  const totals = data.reduce(
    (acc, m) => ({
      views: acc.views + (m.views || 0),
      chats: acc.chats + (m.chats_nuevos || 0),
      conversaciones: acc.conversaciones + (m.conversaciones_nuevas || 0),
      agendas: acc.agendas + (m.agendas || 0),
      shows: acc.shows + (m.shows || 0),
      cierres: acc.cierres + (m.cierres || 0),
      cash: acc.cash + (m.cash_collected || 0),
    }),
    { views: 0, chats: 0, conversaciones: 0, agendas: 0, shows: 0, cierres: 0, cash: 0 }
  )

  function safeRate(num: number, den: number): number {
    return den > 0 ? Math.round((num / den) * 10000) / 100 : 0
  }

  return {
    totals,
    rates: {
      respuesta: safeRate(totals.chats, totals.views),
      conversion: safeRate(totals.conversaciones, totals.chats),
      agendamiento: safeRate(totals.agendas, totals.conversaciones),
      show_up: safeRate(totals.shows, totals.agendas),
      cierre: safeRate(totals.cierres, totals.shows),
    },
    pieces_count: data.length,
  }
}
