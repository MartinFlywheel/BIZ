'use server'

import { createClient } from '@/lib/supabase/server'
import type { DashboardMetrics, BenchmarkAlert } from '@/lib/types'
import { getEffectiveMetricsForRange } from './live-metrics'
import { fetchAllRows } from '@/lib/supabase/paginate'

export async function getDashboardMetrics(
  clientId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<DashboardMetrics> {
  const supabase = await createClient()

  let interactionsQuery = supabase
    .from('interactions')
    .select('classification', { count: 'exact', head: true })
    .eq('client_id', clientId)

  let convRealQuery = supabase
    .from('interactions')
    .select('classification', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('classification', 'conversacion_real')

  if (dateFrom) {
    interactionsQuery = interactionsQuery.gte('bot_triggered_at', dateFrom)
    convRealQuery = convRealQuery.gte('bot_triggered_at', dateFrom)
  }
  if (dateTo) {
    interactionsQuery = interactionsQuery.lte('bot_triggered_at', dateTo)
    convRealQuery = convRealQuery.lte('bot_triggered_at', dateTo)
  }

  // These fetch actual rows (not just a count) to filter/sum client-side,
  // so — unlike the count-only queries above — they need to page past
  // Supabase's 1000-row cap explicitly.
  //
  // Agendas/shows/cierres come from agenda_records.estado — the same
  // source calculateFunnel/getLiveMetricsBuckets already use. This used
  // to filter leads.stage against 'agenda_set'/'showed_up'/'closed_won'/
  // 'closed_lost', values from an old English stage taxonomy that no
  // longer exists (LEAD_STAGES today is 'agendado'/'cierre'/etc, in
  // Spanish) — so this always matched zero rows and Tasa de Show-up /
  // Tasa de Cierre showed 0.0% regardless of real activity.
  const [interactionsRes, convRealRes, agendaRecords, views] = await Promise.all([
    interactionsQuery,
    convRealQuery,
    fetchAllRows((from, to) => {
      let q = supabase.from('agenda_records').select('estado, monto_facturacion, monto_upfront').eq('client_id', clientId).range(from, to)
      if (dateFrom) q = q.gte('fecha_agenda', dateFrom)
      if (dateTo) q = q.lte('fecha_agenda', dateTo)
      return q
    }),
    fetchAllRows((from, to) => {
      let q = supabase.from('content_pieces').select('views').eq('client_id', clientId).range(from, to)
      if (dateFrom) q = q.gte('published_at', dateFrom)
      if (dateTo) q = q.lte('published_at', dateTo)
      return q
    }),
  ])

  const chats_abiertos = interactionsRes.count || 0
  const conversaciones_reales = convRealRes.count || 0

  const agendas = agendaRecords.length
  // "Llamadas" = agendas whose call already happened (excludes 'Pendiente'
  // bookings that haven't had the chance to show yet).
  const llamadas = agendaRecords.filter((a) =>
    a.estado && ['Show', 'No Show', 'No Cerrado', 'Cerrado', 'No Calificado'].includes(a.estado)
  ).length
  const show_ups = agendaRecords.filter((a) =>
    a.estado && ['Show', 'No Cerrado', 'Cerrado'].includes(a.estado)
  ).length
  const cierresRows = agendaRecords.filter((a) => a.estado === 'Cerrado')
  const cierres = cierresRows.length
  const facturacion = cierresRows.reduce((sum, a) => sum + (Number(a.monto_facturacion) || 0), 0)
  const cash_collected = cierresRows.reduce((sum, a) => sum + (Number(a.monto_upfront) || 0), 0)

  const total_views = views.reduce((sum, c) => sum + (c.views || 0), 0)

  const tasa_respuesta = chats_abiertos > 0
    ? (conversaciones_reales / chats_abiertos) * 100
    : 0
  // Against conversaciones reales (real conversations), not raw chats —
  // matches calculateFunnel's own agendamiento rate.
  const tasa_agendamiento = conversaciones_reales > 0 ? (agendas / conversaciones_reales) * 100 : 0
  const tasa_show_up = llamadas > 0 ? (show_ups / llamadas) * 100 : 0
  const tasa_cierre = show_ups > 0 ? (cierres / show_ups) * 100 : 0

  return {
    chats_abiertos,
    conversaciones_reales,
    agendas,
    show_ups,
    cierres,
    facturacion,
    cash_collected,
    total_views,
    tasa_respuesta,
    tasa_agendamiento,
    tasa_show_up,
    tasa_cierre,
  }
}

// Aggregate funnel for the content tab — reads from the systems that already
// track these events live: content_pieces (Meta sync), interactions
// (ManyChat), agenda_records (Calendly + CRM closing).
export async function getClientFunnelTotals(clientId: string) {
  const supabase = await createClient()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const [viewsRows, live] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from('content_pieces').select('views').eq('client_id', clientId).range(from, to)
    ),
    getEffectiveMetricsForRange(clientId, start, end),
  ])

  const views = viewsRows.reduce((s, cp) => s + (cp.views || 0), 0)

  return {
    views,
    chats: live.chats_abiertos,
    conversaciones: live.conversaciones,
    agendas: live.agendas,
    shows: live.shows,
    cierres: live.cierres,
    facturacion: live.facturacion,
    cash: live.cash_collected,
  }
}

export type ClientFunnelTotals = Awaited<ReturnType<typeof getClientFunnelTotals>>

// ── Month-over-month comparison ──────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

export interface MonthComparisonMetric {
  current: number
  previous: number
  // null = no baseline to compare against (previous was 0 but current isn't) —
  // a percentage there would be infinite/meaningless, so the UI shows "Nuevo"
  // instead of a made-up number.
  deltaPct: number | null
}

// Rates (already a %) compare as a point difference, not a relative % change
// of a percentage — going from 10% to 15% reading as "+50%" would be
// confusing; "+5 pts" is what it actually means. Point differences are
// always defined (no division-by-zero case like count-based % change has),
// so there's no null case here.
export interface RateComparisonMetric {
  current: number
  previous: number
  deltaPoints: number
}

export interface MonthComparison {
  currentRange: { start: string; end: string }
  previousRange: { start: string; end: string }
  views: MonthComparisonMetric
  chats: MonthComparisonMetric
  conversaciones: MonthComparisonMetric
  agendas: MonthComparisonMetric
  cierres: MonthComparisonMetric
  facturacion: MonthComparisonMetric
  tasaRespuesta: RateComparisonMetric
  tasaAgendamiento: RateComparisonMetric
  tasaShowUp: RateComparisonMetric
  tasaCierre: RateComparisonMetric
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

// Compares month-to-date against the SAME number of days last month — not
// full calendar month vs full calendar month. Mid-month, a partial current
// month against a complete previous one would always read as a decline
// regardless of actual pace, which defeats the point of a "did we go up or
// down" comparison.
//
// Built on getDashboardMetrics (dateFrom/dateTo scoped) rather than a
// separate computation, so every number here is guaranteed consistent with
// what "Métricas en Vivo (CRM)" shows for the same client — same source
// tables, same classification/estado rules, just date-scoped twice.
export async function getMonthOverMonthComparison(clientId: string): Promise<MonthComparison> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  const currentStart = new Date(year, month, 1)

  const previousMonthFirst = new Date(year, month - 1, 1)
  const daysInPreviousMonth = new Date(previousMonthFirst.getFullYear(), previousMonthFirst.getMonth() + 1, 0).getDate()
  const previousStart = previousMonthFirst
  const previousEnd = new Date(previousMonthFirst.getFullYear(), previousMonthFirst.getMonth(), Math.min(day, daysInPreviousMonth))

  const currentRange = { start: toDateStr(currentStart), end: toDateStr(now) }
  const previousRange = { start: toDateStr(previousStart), end: toDateStr(previousEnd) }

  const [current, previous] = await Promise.all([
    getDashboardMetrics(clientId, currentRange.start, currentRange.end),
    getDashboardMetrics(clientId, previousRange.start, previousRange.end),
  ])

  function count(currentValue: number, previousValue: number): MonthComparisonMetric {
    return { current: currentValue, previous: previousValue, deltaPct: pctChange(currentValue, previousValue) }
  }

  function rate(currentValue: number, previousValue: number): RateComparisonMetric {
    return { current: currentValue, previous: previousValue, deltaPoints: currentValue - previousValue }
  }

  return {
    currentRange,
    previousRange,
    views: count(current.total_views, previous.total_views),
    chats: count(current.chats_abiertos, previous.chats_abiertos),
    conversaciones: count(current.conversaciones_reales, previous.conversaciones_reales),
    agendas: count(current.agendas, previous.agendas),
    cierres: count(current.cierres, previous.cierres),
    facturacion: count(current.facturacion, previous.facturacion),
    tasaRespuesta: rate(current.tasa_respuesta, previous.tasa_respuesta),
    tasaAgendamiento: rate(current.tasa_agendamiento, previous.tasa_agendamiento),
    tasaShowUp: rate(current.tasa_show_up, previous.tasa_show_up),
    tasaCierre: rate(current.tasa_cierre, previous.tasa_cierre),
  }
}

export async function getBenchmarkAlerts(
  clientId: string,
  metrics: DashboardMetrics
): Promise<BenchmarkAlert[]> {
  const supabase = await createClient()

  const { data: benchmarks } = await supabase
    .from('benchmarks')
    .select('*')
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .order('client_id', { ascending: false, nullsFirst: false })

  if (!benchmarks) return []

  const seen = new Set<string>()
  const alerts: BenchmarkAlert[] = []

  for (const b of benchmarks) {
    if (seen.has(b.metric_key)) continue
    seen.add(b.metric_key)

    const metricMap: Record<string, number> = {
      tasa_respuesta: metrics.tasa_respuesta,
      tasa_show_up: metrics.tasa_show_up,
      tasa_cierre: metrics.tasa_cierre,
    }

    const current = metricMap[b.metric_key]
    if (current === undefined) continue

    const is_failing =
      b.comparison === 'gte' ? current < b.threshold_value : current > b.threshold_value

    alerts.push({
      metric_key: b.metric_key,
      current_value: current,
      threshold_value: b.threshold_value,
      comparison: b.comparison,
      is_failing,
      diagnosis_message: b.diagnosis_message,
      responsible_area: b.responsible_area,
    })
  }

  return alerts
}
