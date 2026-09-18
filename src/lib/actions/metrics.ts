'use server'

import { createClient } from '@/lib/supabase/server'
import type { DashboardMetrics } from '@/lib/types'
import { getEffectiveMetricsForRange, type ContentTypeFilter } from './live-metrics'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { hoyChile } from '@/lib/fecha-chile'

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

// ── Comparación con el período anterior ──────────────────────────────────────

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

// El período elegido en el Dashboard contra el anterior del mismo largo
// (src/lib/periodos.ts, periodoAnterior). Antes era siempre el mes en curso
// contra el mes anterior completo: 18 días de septiembre contra 31 de agosto,
// y todo salía a la baja solo por tener menos días. Además ignoraba el período
// elegido arriba, así que no hablaba de lo mismo que el embudo.
//
// Built on getDashboardMetrics, el mismo cálculo que el embudo: los números
// del período actual son los del embudo.
export async function getComparacionDePeriodos(
  clientId: string,
  currentRange: { start: string; end: string },
  previousRange: { start: string; end: string },
  contentType?: ContentTypeFilter
): Promise<MonthComparison> {
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
