'use server'

import { createClient } from '@/lib/supabase/server'
import type { DashboardMetrics, BenchmarkAlert } from '@/lib/types'
import { getEffectiveMetricsForRange, type ContentTypeFilter } from './live-metrics'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { hoyChile, primerDiaDelMes, sumarMeses, ultimoDiaDe } from '@/lib/fecha-chile'

/**
 * Totales y tasas de un rango, con el mismo cálculo que el embudo del
 * Dashboard (getEffectiveMetricsForRange): vistas de reels, carruseles e
 * historias (con los insights de Meta cuando existen), chats y conversaciones
 * por día, agendas por fecha de llamada sin contar días futuros, y las
 * correcciones del Diario.
 *
 * Antes contaba por su cuenta: sin correcciones, sin carruseles ni insights
 * de historias y, sin fechas, sobre toda la historia del cliente. En el
 * Dashboard, las tarjetas "Métricas en Vivo" mostraban el total histórico
 * (17.9K chats) al lado de un embudo de 15 días (748 chats), y la Comparativa
 * Mensual no cuadraba con el embudo en "Mes".
 */
export async function getDashboardMetrics(
  clientId: string,
  dateFrom: string,
  dateTo: string,
  contentType?: ContentTypeFilter
): Promise<DashboardMetrics> {
  const m = await getEffectiveMetricsForRange(clientId, dateFrom, dateTo, contentType)

  const total_views = m.views_reels + m.views_carruseles + m.views_historias
  const tasa = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0)

  return {
    chats_abiertos: m.chats_abiertos,
    conversaciones_reales: m.conversaciones,
    agendas: m.agendas,
    llamadas: m.llamadas,
    show_ups: m.shows,
    cierres: m.cierres,
    facturacion: m.facturacion,
    cash_collected: m.cash_collected,
    total_views,
    // Las mismas cinco tasas del embudo, con los mismos denominadores.
    tasa_chats: tasa(m.chats_abiertos, total_views),
    tasa_respuesta: tasa(m.conversaciones, m.chats_abiertos),
    tasa_agendamiento: tasa(m.agendas, m.conversaciones),
    tasa_show_up: tasa(m.shows, m.llamadas),
    tasa_cierre: tasa(m.cierres, m.shows),
  }
}

// Aggregate funnel for the content tab — reads from the systems that already
// track these events live: content_pieces (Meta sync), interactions
// (ManyChat), agenda_records (Calendly + CRM closing).
export async function getClientFunnelTotals(clientId: string) {
  const supabase = await createClient()
  // Mes en curso de Chile y hasta hoy: antes iba hasta el último día del mes
  // (en UTC), así que las agendas ya puestas para días futuros sumaban.
  const hoy = hoyChile()
  const start = `${hoy.iso.slice(0, 7)}-01`
  const end = hoy.iso

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
    // Agendas cuya llamada ya tuvo desenlace: denominador del show rate, para
    // que las agendas aún pendientes no se cuenten como no-shows.
    llamadas: live.llamadas,
    shows: live.shows,
    cierres: live.cierres,
    facturacion: live.facturacion,
    cash: live.cash_collected,
  }
}

export type ClientFunnelTotals = Awaited<ReturnType<typeof getClientFunnelTotals>>

// ── Month-over-month comparison ──────────────────────────────────────────────

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
  tasaChats: RateComparisonMetric
  tasaRespuesta: RateComparisonMetric
  tasaAgendamiento: RateComparisonMetric
  tasaShowUp: RateComparisonMetric
  tasaCierre: RateComparisonMetric
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

// Current month-to-date vs the FULL previous calendar month — not the same
// number of days last month. Was originally day-matched (Jul 1-22 vs Aug
// 1-22) to avoid a partial month always reading as a decline, but that
// truncation hid real closed deals that landed in the back half of last
// month (a client closed 5 sales in July; the day-matched window only
// covered Jul 1-22 and showed 0). The person reading this already knows
// the current month isn't over — what they actually want is last month's
// real total as the reference point, not a fairness-adjusted one.
//
// Built on getDashboardMetrics, que usa el mismo cálculo que el embudo: con el
// período "Mes" y el mismo filtro de contenido, los números del mes en curso
// son los del embudo.
export async function getMonthOverMonthComparison(clientId: string, contentType?: ContentTypeFilter): Promise<MonthComparison> {
  // Mes y día en hora de Chile, no del servidor (UTC): desde las 21:00 del
  // último día del mes, el "mes actual" pasaba a ser el siguiente.
  const hoy = hoyChile()
  const mesActual = hoy.iso.slice(0, 7)
  const mesAnterior = sumarMeses(mesActual, -1)

  const currentRange = { start: primerDiaDelMes(mesActual), end: hoy.iso }
  const previousRange = { start: primerDiaDelMes(mesAnterior), end: ultimoDiaDe(mesAnterior) }

  const [current, previous] = await Promise.all([
    getDashboardMetrics(clientId, currentRange.start, currentRange.end, contentType),
    getDashboardMetrics(clientId, previousRange.start, previousRange.end, contentType),
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
    tasaChats: rate(current.tasa_chats, previous.tasa_chats),
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

    // Sin denominador no hay nada que diagnosticar. getDashboardMetrics
    // devuelve 0 cuando nadie llego a esa etapa todavia (0 llamadas => 0% de
    // show-up), y comparar ese 0 contra el benchmark marcaba como "critico" a
    // cualquier cliente recien creado o sin actividad en el periodo. Es la
    // misma distincion que ya hacen calculateFunnel (denominator === 0 =>
    // 'healthy') y la tabla de Equipo (null => "—" en vez de 0.00%).
    const denominadorPorMetrica: Record<string, number> = {
      tasa_respuesta: metrics.chats_abiertos,
      tasa_show_up: metrics.llamadas,
      tasa_cierre: metrics.show_ups,
    }

    const current = metricMap[b.metric_key]
    if (current === undefined) continue
    if ((denominadorPorMetrica[b.metric_key] ?? 0) <= 0) continue

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
