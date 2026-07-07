'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunnelStage, FunnelResult, ClientHealthAlert } from '@/lib/types'


// =====================================================
// Funnel stage definition — order matters
// Types live in lib/types.ts ('use server' files can only export async fns)
// =====================================================

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0

  return (numerator / denominator) * 100
}

export async function calculateFunnel(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  periodStart?: string
): Promise<FunnelResult | null> {
  const supabase = await createClient()

  let query = supabase
    .from('client_metrics')
    .select('*')
    .eq('client_id', clientId)
    .eq('period_type', periodType)
    .order('period_start', { ascending: false })
    .limit(1)

  if (periodStart) {
    query = query.eq('period_start', periodStart)
  }

  const { data, error } = await query.maybeSingle()

  if (error || !data) return null

  const {
    views_reels,
    views_historias,
    chats_abiertos,
    conversaciones,
    agendas,
    shows,
    cierres,
    facturacion,
    cash_collected,
  } = data

  const rates = {
    respuesta_reel: safeRate(chats_abiertos, views_reels),
    respuesta_historia: safeRate(chats_abiertos, views_historias),
    conversion: safeRate(conversaciones, chats_abiertos),
    agendamiento: safeRate(agendas, conversaciones),
    show_up: safeRate(shows, agendas),
    cierre: safeRate(cierres, shows),
  }

  const stagesDef: Array<{
    id: string
    label: string
    value: number
    rate: number
    min: number
    max: number
  }> = [
      { id: 'respuesta_reel', label: 'Respuesta Reel', value: views_reels, rate: rates.respuesta_reel, min: 1, max: 3 },
      { id: 'respuesta_historia', label: 'Respuesta Historia', value: views_historias, rate: rates.respuesta_historia, min: 1, max: 5 },
      { id: 'conversion', label: 'Conversión', value: chats_abiertos, rate: rates.conversion, min: 70, max: 100 },
      { id: 'agendamiento', label: 'Agendamiento', value: conversaciones, rate: rates.agendamiento, min: 8, max: 12 },
      { id: 'show_up', label: 'Show-up', value: agendas, rate: rates.show_up, min: 70, max: 100 },
      { id: 'cierre', label: 'Cierre', value: shows, rate: rates.cierre, min: 30, max: 60 },
    ]

  // Find bottleneck: stage with the biggest shortfall below benchmark
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

  const stages: FunnelStage[] = stagesDef.map((s) => ({
    id: s.id,
    label: s.label,
    value: s.value,
    rate: Math.round(s.rate * 100) / 100,
    benchmark_min: s.min,
    benchmark_max: s.max,
    status: s.rate >= s.min ? 'healthy' : 'critical',
    is_bottleneck: s.id === bottleneckId,
  }))

  return {
    stages,
    bottleneck: bottleneckId,
    bottleneck_drop: Math.round(worstDrop * 100) / 100,
    period: {
      start: data.period_start,
      end: data.period_end,
      type: data.period_type,
    },
    raw: {
      views_reels,
      views_historias,
      chats_abiertos,
      conversaciones,
      agendas,
      shows,
      cierres,
      facturacion,
      cash_collected,
    },
  }
}

// =====================================================
// Health Alerts — scans ALL active clients
// =====================================================

export async function checkHealthAlerts(
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly'
): Promise<ClientHealthAlert[]> {
  const supabase = await createClient()


  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, ig_handle')
    .eq('status', 'active')

  if (!clients || clients.length === 0) return []

  const results: ClientHealthAlert[] = []

  for (const client of clients) {
    const funnel = await calculateFunnel(client.id, periodType)

    if (!funnel) {
      results.push({
        client_id: client.id,
        client_name: client.name,
        ig_handle: client.ig_handle,
        alerts: [],
        worst_stage: null,
        status: 'healthy',
      })
      continue
    }

    const alerts = funnel.stages
      .filter((s) => s.status === 'critical')
      .map((s) => ({
        stage_id: s.id,
        stage_label: s.label,
        current_rate: s.rate,
        benchmark_min: s.benchmark_min,
        deficit: Math.round((s.benchmark_min - s.rate) * 100) / 100,
      }))
      .sort((a, b) => b.deficit - a.deficit)

    results.push({
      client_id: client.id,
      client_name: client.name,
      ig_handle: client.ig_handle,
      alerts,
      worst_stage: funnel.bottleneck,
      status: alerts.length > 0 ? 'critical' : 'healthy',
    })
  }

  return results.sort((a, b) => b.alerts.length - a.alerts.length)
}

// =====================================================
// CRUD for client_metrics
// =====================================================

export async function getClientMetrics(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  limit = 12
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('client_metrics')
    .select('*')
    .eq('client_id', clientId)
    .eq('period_type', periodType)
    .order('period_start', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}

export async function upsertClientMetrics(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('client_metrics')
    .upsert({
      client_id: formData.get('client_id') as string,
      period_start: formData.get('period_start') as string,
      period_end: formData.get('period_end') as string,
      period_type: (formData.get('period_type') as string) || 'weekly',
      views_reels: parseInt(formData.get('views_reels') as string) || 0,
      views_historias: parseInt(formData.get('views_historias') as string) || 0,
      followers_gained: parseInt(formData.get('followers_gained') as string) || 0,
      chats_abiertos: parseInt(formData.get('chats_abiertos') as string) || 0,
      conversaciones: parseInt(formData.get('conversaciones') as string) || 0,
      agendas: parseInt(formData.get('agendas') as string) || 0,
      shows: parseInt(formData.get('shows') as string) || 0,
      cierres: parseInt(formData.get('cierres') as string) || 0,
      facturacion: parseFloat(formData.get('facturacion') as string) || 0,
      cash_collected: parseFloat(formData.get('cash_collected') as string) || 0,
      notes: (formData.get('notes') as string) || null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'client_id,period_start,period_type',
    })

  if (error) throw error

  const clientId = formData.get('client_id') as string
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
}

// ── Direct row save (used by the inline spreadsheet component) ──

export interface MetricsRow {
  client_id: string
  period_type: 'daily' | 'weekly' | 'monthly'
  period_start: string
  period_end: string
  views_reels: number
  views_historias: number
  followers_gained: number
  chats_abiertos: number
  conversaciones: number
  agendas: number
  shows: number
  cierres: number
  facturacion: number
  cash_collected: number
  notes: string | null
}

export async function saveMetricsRow(row: MetricsRow) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('client_metrics')
    .upsert({ ...row, updated_at: new Date().toISOString() }, {
      onConflict: 'client_id,period_start,period_type',
    })

  if (error) throw error
  revalidatePath(`/clients/${row.client_id}`)
}

export async function deleteMetricsRow(clientId: string, periodStart: string, periodType: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('client_metrics')
    .delete()
    .eq('client_id', clientId)
    .eq('period_start', periodStart)
    .eq('period_type', periodType)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

