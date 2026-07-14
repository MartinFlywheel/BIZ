'use server'

import { createClient } from '@/lib/supabase/server'
import type { DashboardMetrics, BenchmarkAlert } from '@/lib/types'
import { getEffectiveMetricsForRange } from './live-metrics'

export async function getDashboardMetrics(
  clientId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<DashboardMetrics> {
  const supabase = await createClient()

  let interactionsQuery = supabase
    .from('interactions')
    .select('classification', { count: 'exact' })
    .eq('client_id', clientId)

  let leadsQuery = supabase
    .from('leads')
    .select('stage', { count: 'exact' })
    .eq('client_id', clientId)

  let viewsQuery = supabase
    .from('content_pieces')
    .select('views')
    .eq('client_id', clientId)

  if (dateFrom) {
    interactionsQuery = interactionsQuery.gte('bot_triggered_at', dateFrom)
    leadsQuery = leadsQuery.gte('created_at', dateFrom)
    viewsQuery = viewsQuery.gte('published_at', dateFrom)
  }
  if (dateTo) {
    interactionsQuery = interactionsQuery.lte('bot_triggered_at', dateTo)
    leadsQuery = leadsQuery.lte('created_at', dateTo)
    viewsQuery = viewsQuery.lte('published_at', dateTo)
  }

  const [interactionsRes, convRealRes, leadsRes, viewsRes] = await Promise.all([
    interactionsQuery,
    supabase
      .from('interactions')
      .select('classification', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('classification', 'conversacion_real')
      .then((r) => r),
    leadsQuery.select('stage'),
    viewsQuery,
  ])

  const chats_abiertos = interactionsRes.count || 0
  const conversaciones_reales = convRealRes.count || 0

  const leads = leadsRes.data || []
  const agendas = leads.filter((l) =>
    ['agenda_set', 'showed_up', 'closed_won', 'closed_lost'].includes(l.stage)
  ).length
  const show_ups = leads.filter((l) =>
    ['showed_up', 'closed_won'].includes(l.stage)
  ).length
  const cierres = leads.filter((l) => l.stage === 'closed_won').length

  const total_views = (viewsRes.data || []).reduce((sum, c) => sum + (c.views || 0), 0)

  const tasa_respuesta = chats_abiertos > 0
    ? (conversaciones_reales / chats_abiertos) * 100
    : 0
  const tasa_show_up = agendas > 0 ? (show_ups / agendas) * 100 : 0
  const tasa_cierre = show_ups > 0 ? (cierres / show_ups) * 100 : 0

  return {
    chats_abiertos,
    conversaciones_reales,
    agendas,
    show_ups,
    cierres,
    total_views,
    tasa_respuesta,
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

  const [viewsRes, live] = await Promise.all([
    supabase.from('content_pieces').select('views').eq('client_id', clientId),
    getEffectiveMetricsForRange(clientId, start, end),
  ])

  const views = (viewsRes.data || []).reduce((s, cp) => s + (cp.views || 0), 0)

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
