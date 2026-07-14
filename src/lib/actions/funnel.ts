'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunnelStage, FunnelResult, ClientHealthAlert } from '@/lib/types'
import { getLiveMetricsForRange, getLiveMetricsBuckets } from './live-metrics'


// =====================================================
// Funnel stage definition — order matters
// Types live in lib/types.ts ('use server' files can only export async fns)
// =====================================================

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0

  return (numerator / denominator) * 100
}

function mondayOf(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Resolves [start, end] date-string bounds for a period, anchored on
// periodStart when given, otherwise the current period.
function periodBounds(
  periodType: 'daily' | 'weekly' | 'monthly',
  periodStart?: string
): { start: string; end: string } {
  const anchor = periodStart ? new Date(`${periodStart}T12:00:00Z`) : new Date()

  if (periodType === 'daily') {
    const start = periodStart || toDateStr(anchor)
    return { start, end: start }
  }

  if (periodType === 'monthly') {
    const start = periodStart
      ? `${periodStart.slice(0, 7)}-01`
      : `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-01`
    const end = new Date(`${start}T12:00:00Z`)
    end.setMonth(end.getMonth() + 1, 0)
    return { start, end: toDateStr(end) }
  }

  const monday = mondayOf(anchor)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return { start: toDateStr(monday), end: toDateStr(sunday) }
}

export async function calculateFunnel(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  periodStart?: string
): Promise<FunnelResult | null> {
  const { start, end } = periodBounds(periodType, periodStart)
  const data = await getLiveMetricsForRange(clientId, start, end)

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

  // No activity at all in this period — treat as "no data" rather than a
  // failing funnel (avoids flagging brand-new/inactive clients as critical).
  if (views_reels + views_historias + chats_abiertos + agendas === 0) return null

  const rates = {
    respuesta_reel: safeRate(chats_abiertos, views_reels),
    respuesta_historia: safeRate(chats_abiertos, views_historias),
    conversion: safeRate(conversaciones, chats_abiertos),
    agendamiento: safeRate(agendas, conversaciones),
    show_up: safeRate(shows, agendas),
    cierre: safeRate(cierres, shows),
  }

  // Each stage shows the OUTPUT count at that level (how many reached here),
  // and the rate is the conversion FROM the previous stage TO this one.
  const stagesDef: Array<{
    id: string
    label: string
    value: number
    rate: number
    min: number
    max: number
  }> = [
    // ── Marketing ──────────────────────────────────────────────────────────
    { id: 'vistas',        label: 'Vistas Reels',   value: views_reels,     rate: 0,                       min: 0,  max: 0   },
    { id: 'chats',         label: 'Chats',           value: chats_abiertos,  rate: rates.respuesta_reel,    min: 1,  max: 3   },
    { id: 'conversaciones',label: 'Conversaciones',  value: conversaciones,  rate: rates.conversion,        min: 70, max: 100 },
    // ── Ventas ─────────────────────────────────────────────────────────────
    { id: 'agendas',       label: 'Agendas',         value: agendas,         rate: rates.agendamiento,      min: 8,  max: 12  },
    { id: 'shows',         label: 'Shows',           value: shows,           rate: rates.show_up,           min: 70, max: 100 },
    { id: 'cierres',       label: 'Cierres',         value: cierres,         rate: rates.cierre,            min: 30, max: 60  },
  ]

  // Find bottleneck: stage with the biggest shortfall below benchmark
  let worstDrop = 0
  let bottleneckId: string | null = null

  for (const s of stagesDef) {
    if (s.min === 0) continue   // skip entry stage
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
    status: s.min === 0 ? 'healthy' : s.rate >= s.min ? 'healthy' : 'critical',
    is_bottleneck: s.id === bottleneckId,
  }))

  return {
    stages,
    bottleneck: bottleneckId,
    bottleneck_drop: Math.round(worstDrop * 100) / 100,
    period: {
      start,
      end,
      type: periodType,
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
// Computed period metrics (Contenido y Métricas → "Registro de métricas")
// Everything except Seguidores + and Notas is live from source tables —
// only those two fields still live in client_metrics.
// =====================================================

function recentPeriods(
  periodType: 'daily' | 'weekly' | 'monthly',
  count: number
): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = []
  let anchorStr: string | undefined

  for (let i = 0; i < count; i++) {
    const { start, end } = periodBounds(periodType, anchorStr)
    periods.push({ start, end })
    const prev = new Date(`${start}T12:00:00Z`)
    prev.setDate(prev.getDate() - 1)
    anchorStr = toDateStr(prev)
  }

  return periods
}

export interface ComputedMetricsRow {
  period_start: string
  period_end: string
  views_reels: number
  views_historias: number
  chats_abiertos: number
  conversaciones: number
  agendas: number
  shows: number
  cierres: number
  facturacion: number
  cash_collected: number
  followers_gained: number
  notes: string | null
}

export async function getComputedClientMetrics(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  count = 12
): Promise<ComputedMetricsRow[]> {
  const periods = recentPeriods(periodType, count)
  const buckets = periods.map((p) => ({ key: p.start, start: p.start, end: p.end }))

  const supabase = await createClient()

  const [live, manualRes] = await Promise.all([
    getLiveMetricsBuckets(clientId, buckets),
    supabase
      .from('client_metrics')
      .select('period_start, followers_gained, notes')
      .eq('client_id', clientId)
      .eq('period_type', periodType)
      .in('period_start', periods.map((p) => p.start)),
  ])

  const manualByStart = new Map((manualRes.data || []).map((r) => [r.period_start as string, r]))

  return periods.map((p) => {
    const manual = manualByStart.get(p.start)
    return {
      period_start: p.start,
      period_end: p.end,
      ...live[p.start],
      followers_gained: manual?.followers_gained ?? 0,
      notes: manual?.notes ?? null,
    }
  })
}

export async function saveMetricsNotes(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
  fields: { followers_gained?: number; notes?: string | null }
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('client_metrics')
    .upsert(
      {
        client_id: clientId,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        ...fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,period_start,period_type' }
    )

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

// =====================================================
// Legacy manual form (kept for the standalone metrics-entry modal)
// =====================================================

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


