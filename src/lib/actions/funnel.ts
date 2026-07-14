'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunnelStage, FunnelResult, ClientHealthAlert } from '@/lib/types'
import { getLiveMetricsBuckets, getEffectiveMetricsForRange } from './live-metrics'
import { OVERRIDABLE_FIELDS, type OverridableField } from '@/lib/metrics-types'


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
  const data = await getEffectiveMetricsForRange(clientId, start, end)

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

  // Combined views (reel + historia) — a client whose CTA lives in Historias
  // shouldn't show a phantom 0% "chats" rate just because views_reels is 0.
  const totalViews = views_reels + views_historias

  const rates = {
    respuesta: safeRate(chats_abiertos, totalViews),
    conversion: safeRate(conversaciones, chats_abiertos),
    agendamiento: safeRate(agendas, conversaciones),
    show_up: safeRate(shows, agendas),
    cierre: safeRate(cierres, shows),
  }

  // Each stage shows the OUTPUT count at that level (how many reached here),
  // and the rate is the conversion FROM the previous stage TO this one.
  // `denominator` is that previous stage's count — when it's 0, nobody has
  // reached this stage yet, so its rate is meaningless (not a real deficit).
  const stagesDef: Array<{
    id: string
    label: string
    value: number
    rate: number
    min: number
    max: number
    denominator: number
  }> = [
    // ── Marketing ──────────────────────────────────────────────────────────
    { id: 'vistas',        label: 'Vistas Reels',   value: views_reels,     rate: 0,                 min: 0,  max: 0,   denominator: 1 },
    { id: 'chats',         label: 'Chats',           value: chats_abiertos,  rate: rates.respuesta,   min: 1,  max: 3,   denominator: totalViews },
    { id: 'conversaciones',label: 'Conversaciones',  value: conversaciones,  rate: rates.conversion,  min: 70, max: 100, denominator: chats_abiertos },
    // ── Ventas ─────────────────────────────────────────────────────────────
    { id: 'agendas',       label: 'Agendas',         value: agendas,         rate: rates.agendamiento,min: 8,  max: 12,  denominator: conversaciones },
    { id: 'shows',         label: 'Shows',           value: shows,           rate: rates.show_up,     min: 70, max: 100, denominator: agendas },
    { id: 'cierres',       label: 'Cierres',         value: cierres,         rate: rates.cierre,      min: 30, max: 60,  denominator: shows },
  ]

  // Find bottleneck: stage with the biggest shortfall below benchmark —
  // only among stages that actually received traffic (denominator > 0).
  // A stage nobody has reached yet (e.g. Shows when Agendas is 0) can't be
  // diagnosed as "underperforming"; the real problem is further upstream.
  let worstDrop = 0
  let bottleneckId: string | null = null

  for (const s of stagesDef) {
    if (s.min === 0) continue        // skip entry stage
    if (s.denominator === 0) continue // no traffic reached this stage — nothing to diagnose
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
    status: s.min === 0 || s.denominator === 0 ? 'healthy' : s.rate >= s.min ? 'healthy' : 'critical',
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
  // Fields present here were manually corrected — the value above is the
  // override, not the live-computed number.
  overrides: Partial<Record<OverridableField, number>>
  // The raw live-computed numbers, before overrides — lets the UI revert a
  // field back to "auto" without a refetch.
  live: Record<OverridableField, number>
}

export async function getComputedClientMetrics(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  count = 12
): Promise<ComputedMetricsRow[]> {
  const periods = recentPeriods(periodType, count)

  const supabase = await createClient()

  // Notes / Seguidores+ stay editable at whatever granularity is on screen —
  // fetch those regardless of periodType.
  const manualResPromise = supabase
    .from('client_metrics')
    .select('period_start, followers_gained, notes, views_reels, views_historias, chats_abiertos, conversaciones, agendas, shows, cierres, facturacion, cash_collected')
    .eq('client_id', clientId)
    .eq('period_type', periodType)
    .in('period_start', periods.map((p) => p.start))

  if (periodType === 'daily') {
    // Daily is the source of truth for overrides — direct one-row-per-day
    // lookup, editable in the UI.
    const buckets = periods.map((p) => ({ key: p.start, start: p.start, end: p.end }))
    const [live, manualRes] = await Promise.all([getLiveMetricsBuckets(clientId, buckets), manualResPromise])
    const manualByStart = new Map(
      (manualRes.data || []).map((r) => [r.period_start as string, r as Record<string, unknown>])
    )

    return periods.map((p) => {
      const manual = manualByStart.get(p.start)
      const liveRow = live[p.start]

      const overrides: Partial<Record<OverridableField, number>> = {}
      for (const field of OVERRIDABLE_FIELDS) {
        const value = manual?.[field]
        if (value !== null && value !== undefined) overrides[field] = value as number
      }

      const liveFields: Record<OverridableField, number> = {
        views_reels: liveRow.views_reels,
        views_historias: liveRow.views_historias,
        chats_abiertos: liveRow.chats_abiertos,
        conversaciones: liveRow.conversaciones,
        agendas: liveRow.agendas,
        shows: liveRow.shows,
        cierres: liveRow.cierres,
        facturacion: liveRow.facturacion,
        cash_collected: liveRow.cash_collected,
      }

      return {
        period_start: p.start,
        period_end: p.end,
        live: liveFields,
        views_reels: overrides.views_reels ?? liveRow.views_reels,
        views_historias: overrides.views_historias ?? liveRow.views_historias,
        chats_abiertos: overrides.chats_abiertos ?? liveRow.chats_abiertos,
        conversaciones: overrides.conversaciones ?? liveRow.conversaciones,
        agendas: overrides.agendas ?? liveRow.agendas,
        shows: overrides.shows ?? liveRow.shows,
        cierres: overrides.cierres ?? liveRow.cierres,
        facturacion: overrides.facturacion ?? liveRow.facturacion,
        cash_collected: overrides.cash_collected ?? liveRow.cash_collected,
        followers_gained: (manual?.followers_gained as number) ?? 0,
        notes: (manual?.notes as string) ?? null,
        overrides,
      }
    })
  }

  // Weekly/monthly — pure rollups of the daily effective numbers (live, with
  // any Diario overrides already folded in). Not independently editable: a
  // week-level number can't be split back into days unambiguously, so these
  // rows carry no overrides of their own.
  const [effectiveRows, manualRes] = await Promise.all([
    Promise.all(periods.map((p) => getEffectiveMetricsForRange(clientId, p.start, p.end))),
    manualResPromise,
  ])

  const manualByStart = new Map(
    (manualRes.data || []).map((r) => [r.period_start as string, r as Record<string, unknown>])
  )

  return periods.map((p, i) => {
    const manual = manualByStart.get(p.start)
    const effective = effectiveRows[i]

    const liveFields: Record<OverridableField, number> = {
      views_reels: effective.views_reels,
      views_historias: effective.views_historias,
      chats_abiertos: effective.chats_abiertos,
      conversaciones: effective.conversaciones,
      agendas: effective.agendas,
      shows: effective.shows,
      cierres: effective.cierres,
      facturacion: effective.facturacion,
      cash_collected: effective.cash_collected,
    }

    return {
      period_start: p.start,
      period_end: p.end,
      live: liveFields,
      ...liveFields,
      followers_gained: (manual?.followers_gained as number) ?? 0,
      notes: (manual?.notes as string) ?? null,
      overrides: {},
    }
  })
}

export async function saveMetricsOverrides(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
  fields: Partial<Record<OverridableField, number | null>> & { followers_gained?: number; notes?: string | null }
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


