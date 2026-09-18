'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { FunnelResult, ClientHealthAlert } from '@/lib/types'
import { evaluarEmbudo } from '@/lib/embudo'
import {
  getLiveMetricsDetalle,
  getEffectiveMetricsForRange,
  getInicioDelCliente,
  dailyBucketsFor,
  type ContentTypeFilter,
  type PeriodMetrics,
  type DateBucket,
} from './live-metrics'
import { COLUMNAS_CORRECCIONES, OVERRIDABLE_FIELDS, leerCorrecciones, type OverridableField } from '@/lib/metrics-types'
import { hoyChile, lunesDe, minFecha, sumarDias, ultimoDiaDe } from '@/lib/fecha-chile'


// Las etapas, sus metas y la evaluación viven en src/lib/embudo.ts; los tipos,
// en lib/types.ts ('use server' files can only export async fns).

export type FunnelPeriodType = 'daily' | 'weekly' | 'monthly' | '15d' | '30d'

// Límites completos de un período ([start, end], ambos incluidos), anclado en
// periodStart si viene, o en hoy de Chile si no.
//
// "Hoy" se calcula en hora de Chile y no con new Date(): Vercel corre en UTC,
// y desde las 21:00 del último día del mes el servidor ya tomaba el mes
// siguiente como el actual. Las cuentas se hacen sobre strings de fecha, sin
// depender de la zona del proceso.
function limitesDelPeriodo(
  periodType: FunnelPeriodType,
  periodStart?: string
): { start: string; end: string } {
  const anchor = periodStart || hoyChile().iso

  if (periodType === 'daily') {
    return { start: anchor, end: anchor }
  }

  if (periodType === 'monthly') {
    const mes = anchor.slice(0, 7)
    return { start: `${mes}-01`, end: ultimoDiaDe(mes) }
  }

  // Rolling trailing window ending on the anchor date (today, unless a
  // specific end was given) — not calendar-aligned like week/month.
  if (periodType === '15d' || periodType === '30d') {
    const days = periodType === '15d' ? 15 : 30
    return { start: sumarDias(anchor, -(days - 1)), end: anchor }
  }

  const monday = lunesDe(anchor)
  return { start: monday, end: sumarDias(monday, 6) }
}

// Igual que limitesDelPeriodo, pero el período en curso termina hoy: los días
// que todavía no pasan no se cuentan (incluidas las agendas ya puestas para
// esos días). Un período futuro queda con end < start, o sea, vacío.
function periodBounds(
  periodType: FunnelPeriodType,
  periodStart?: string
): { start: string; end: string } {
  const { start, end } = limitesDelPeriodo(periodType, periodStart)
  return { start, end: minFecha(end, hoyChile().iso) }
}

/** Un rango elegido a mano en el Dashboard ('YYYY-MM-DD', ambos incluidos). */
export interface RangoPersonalizado {
  start: string
  end: string
}

export async function calculateFunnel(
  clientId: string,
  periodType: FunnelPeriodType = 'weekly',
  periodStart?: string,
  contentType?: ContentTypeFilter,
  rango?: RangoPersonalizado
): Promise<FunnelResult | null> {
  // Con rango, se usa tal cual (los días que aún no pasan no cuentan, igual
  // que en los períodos fijos); period.type queda como 'custom' para la vista.
  const { start, end } = rango
    ? { start: rango.start, end: minFecha(rango.end, hoyChile().iso) }
    : periodBounds(periodType, periodStart)
  const data = await getEffectiveMetricsForRange(clientId, start, end, contentType)

  const {
    views_reels,
    views_carruseles,
    views_historias,
    chats_abiertos,
    conversaciones,
    agendas,
    llamadas,
    shows,
    cierres,
    facturacion,
    cash_collected,
  } = data

  // Total de vistas del contenido con CTA: reels + carruseles + historias. Es
  // el mismo denominador que usan % Resp. y % Seguid. en el Registro de
  // métricas. Antes los carruseles no entraban, aunque sus chats sí, y la tasa
  // de respuesta salía inflada.
  const totalViews = views_reels + views_carruseles + views_historias

  // No activity at all in this period — treat as "no data" rather than a
  // failing funnel (avoids flagging brand-new/inactive clients as critical).
  if (totalViews + chats_abiertos + agendas === 0) return null

  // Tasas, metas y cuello de botella salen de src/lib/embudo.ts: la misma
  // evaluación que usa el aviso diario de metas.
  const { stages, bottleneck: bottleneckId, bottleneck_drop } = evaluarEmbudo({
    vistas: totalViews,
    chats: chats_abiertos,
    conversaciones,
    agendas,
    llamadas,
    shows,
    cierres,
  })

  return {
    stages,
    bottleneck: bottleneckId,
    bottleneck_drop,
    period: {
      start,
      end,
      type: rango ? 'custom' : periodType,
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

  // Each client's funnel is a handful of fully-paginated table scans
  // (getLiveMetricsBuckets) — running them one client at a time turned this
  // into "sum of every active client's query time" before the dashboard
  // could render anything at all. Running them concurrently instead turns
  // it into "the slowest single client," which is what this was always
  // meant to cost.
  const results = await Promise.all(clients.map(async (client): Promise<ClientHealthAlert> => {
    const funnel = await calculateFunnel(client.id, periodType)

    if (!funnel) {
      return {
        client_id: client.id,
        client_name: client.name,
        ig_handle: client.ig_handle,
        alerts: [],
        worst_stage: null,
        status: 'healthy',
      }
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

    return {
      client_id: client.id,
      client_name: client.name,
      ig_handle: client.ig_handle,
      alerts,
      worst_stage: funnel.bottleneck,
      status: alerts.length > 0 ? 'critical' : 'healthy',
    }
  }))

  return results.sort((a, b) => b.alerts.length - a.alerts.length)
}

// =====================================================
// Computed period metrics (Contenido y Métricas → "Registro de métricas")
// Todo sale en vivo de las tablas de origen, con las correcciones del Diario
// encima. Solo Notas se guarda por granularidad en client_metrics.
// =====================================================

// Tope de seguridad: nunca más de 24 meses hacia atrás, aunque el cliente sea
// más antiguo. Cada período extra alarga la consulta de getLiveMetricsDetalle,
// y un rango muy largo arriesga el statement_timeout (57014).
const TOPE_PERIODOS: Record<'daily' | 'weekly' | 'monthly', number> = {
  monthly: 24,
  weekly: 105,
  daily: 731,
}

// Del período en curso hacia atrás, `count` períodos como máximo y ninguno que
// termine antes del inicio del cliente. Así la tabla Mensual ya no muestra
// meses en que el cliente no existía en el CRM, ni meses posteriores al actual
// de Chile.
function recentPeriods(
  periodType: 'daily' | 'weekly' | 'monthly',
  count: number,
  desde: string | null,
): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = []
  const maximo = Math.max(1, Math.min(count, TOPE_PERIODOS[periodType]))
  let anchorStr: string | undefined

  for (let i = 0; i < maximo; i++) {
    const { start, end } = limitesDelPeriodo(periodType, anchorStr)
    // El período en curso siempre entra, aunque el cliente empiece hoy.
    if (i > 0 && desde && end < desde) break
    periods.push({ start, end })
    anchorStr = sumarDias(start, -1)
  }

  return periods
}

/**
 * Las semanas (lunes a domingo) de un mes, cortadas en sus bordes: en
 * septiembre de 2026, la primera es 1–6 sept y no 31 ago – 6 sept. En el
 * Registro de métricas aparecían semanas de otros meses, y la que cruzaba el
 * cambio de mes contaba días de los dos; así, las semanas del mes suman
 * exactamente lo que muestra Mensual. Las que todavía no empiezan no se
 * incluyen; la semana en curso conserva su fin real para la etiqueta y suma
 * solo hasta hoy, como el resto de la planilla. La más reciente va primero,
 * como en recentPeriods.
 */
function semanasDelMes(mes: string, hoy: string): { start: string; end: string }[] {
  const fin = ultimoDiaDe(mes)
  const semanas: { start: string; end: string }[] = []
  for (let start = `${mes}-01`; start <= fin && start <= hoy; ) {
    const end = minFecha(sumarDias(lunesDe(start), 6), fin)
    semanas.push({ start, end })
    start = sumarDias(end, 1)
  }
  return semanas.reverse()
}

export interface ComputedMetricsRow {
  period_start: string
  period_end: string
  views_reels: number
  views_carruseles: number
  views_historias: number
  chats_abiertos: number
  chats_abiertos_reel: number
  chats_abiertos_historia: number
  conversaciones: number
  conversaciones_reel: number
  conversaciones_historia: number
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

function metricasEnCero(): PeriodMetrics {
  return {
    views_reels: 0, views_carruseles: 0, views_historias: 0, followers_gained: 0,
    chats_abiertos: 0, chats_abiertos_reel: 0, chats_abiertos_historia: 0,
    conversaciones: 0, conversaciones_reel: 0, conversaciones_historia: 0,
    agendas: 0, llamadas: 0, llamadas_no_calificadas: 0, shows: 0, cierres: 0,
    senados: 0, facturacion: 0, cash_collected: 0,
  }
}

function camposCorregibles(m: PeriodMetrics): Record<OverridableField, number> {
  return Object.fromEntries(OVERRIDABLE_FIELDS.map((f) => [f, m[f]])) as Record<OverridableField, number>
}

export async function getComputedClientMetrics(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
  count = 12,
  // Solo para semanal/mensual (la Tendencia Semanal del Dashboard). Con filtro
  // no se aplican las correcciones del Diario, que no distinguen reel de
  // historia: es la misma regla de getEffectiveMetricsForRange, así que la
  // tendencia filtrada cuadra con el embudo filtrado.
  contentType?: ContentTypeFilter,
  // Solo semanal: las semanas de ese mes ('YYYY-MM') en vez de las últimas
  // `count`. Ver semanasDelMes.
  mes?: string
): Promise<ComputedMetricsRow[]> {
  const hoy = hoyChile().iso
  const inicio = await getInicioDelCliente(clientId)
  const periods = periodType === 'weekly' && mes
    ? semanasDelMes(mes, hoy)
    : recentPeriods(periodType, count, inicio)
  if (periods.length === 0) return []

  const supabase = await createClient()

  // Notas siguen editables en la granularidad que está en pantalla.
  const manualResPromise = supabase
    .from('client_metrics')
    .select(periodType === 'daily' ? `${COLUMNAS_CORRECCIONES}, notes` : 'period_start, notes')
    .eq('client_id', clientId)
    .eq('period_type', periodType)
    .in('period_start', periods.map((p) => p.start))

  if (periodType === 'daily') {
    // Daily is the source of truth for overrides — direct one-row-per-day
    // lookup, editable in the UI. recentPeriods arranca en hoy, así que no
    // hay días futuros.
    const buckets = periods.map((p) => ({ key: p.start, start: p.start, end: p.end }))
    const [detalle, manualRes] = await Promise.all([getLiveMetricsDetalle(clientId, buckets), manualResPromise])
    if (manualRes.error) console.error('[funnel] no se pudieron leer las correcciones del Diario:', manualRes.error.message)
    const manualByStart = new Map(
      ((manualRes.data || []) as unknown as Record<string, unknown>[]).map((r) => [r.period_start as string, r])
    )

    return periods.map((p) => {
      const manual = manualByStart.get(p.start)
      const liveRow = detalle.metricas[p.start]
      const overrides = leerCorrecciones(manual, detalle.insightsDisponibles)
      const liveFields = camposCorregibles(liveRow)

      return {
        period_start: p.start,
        period_end: p.end,
        live: liveFields,
        ...liveFields,
        ...overrides,
        views_carruseles: liveRow.views_carruseles,
        chats_abiertos_reel: liveRow.chats_abiertos_reel,
        chats_abiertos_historia: liveRow.chats_abiertos_historia,
        conversaciones_reel: liveRow.conversaciones_reel,
        conversaciones_historia: liveRow.conversaciones_historia,
        notes: (manual?.notes as string) ?? null,
        overrides,
      }
    })
  }

  // Weekly/monthly — pure rollups of the daily effective numbers (live, with
  // any Diario overrides already folded in). Not independently editable: a
  // week-level number can't be split back into days unambiguously, so these
  // rows carry no overrides of their own. Seguidores + también: antes se leía
  // de filas semanales o mensuales escritas a mano, que nunca nadie llenó.
  //
  // Fetched as ONE pass across the full span of all `count` periods, instead
  // of calling getEffectiveMetricsForRange once per period — that used to
  // re-run the whole live-metrics query set (up to 3 paginated table scans
  // each) from scratch per period, turning one render of "Registro de
  // métricas" (12 periods) into dozens of DB round trips.
  //
  // El rango termina hoy: la semana y el mes en curso suman solo lo que ya
  // ocurrió. period_end conserva el fin real del período para la etiqueta.
  const rangeStart = periods.reduce((min, p) => (p.start < min ? p.start : min), periods[0].start)
  const rangeEnd = minFecha(periods.reduce((max, p) => (p.end > max ? p.end : max), periods[0].end), hoy)
  const dayBuckets = await dailyBucketsFor(rangeStart, rangeEnd)

  const [detalle, dailyOverridesRes, manualRes] = await Promise.all([
    getLiveMetricsDetalle(clientId, dayBuckets, contentType),
    supabase
      .from('client_metrics')
      .select(COLUMNAS_CORRECCIONES)
      .eq('client_id', clientId)
      .eq('period_type', 'daily')
      .gte('period_start', rangeStart)
      .lte('period_start', rangeEnd),
    manualResPromise,
  ])

  if (dailyOverridesRes.error) {
    console.error('[funnel] no se pudieron leer las correcciones del Diario:', dailyOverridesRes.error.message)
  }

  const dailyOverridesByDay = new Map(
    (contentType ? [] : (dailyOverridesRes.data || []) as unknown as Record<string, unknown>[]).map((r) => [
      r.period_start as string,
      leerCorrecciones(r, detalle.insightsDisponibles),
    ])
  )

  function effectiveForDay(day: DateBucket): PeriodMetrics {
    return { ...detalle.metricas[day.key], ...dailyOverridesByDay.get(day.key) }
  }

  function sumMetrics(a: PeriodMetrics, b: PeriodMetrics): PeriodMetrics {
    const sum = { ...a }
    for (const key of Object.keys(sum) as (keyof PeriodMetrics)[]) {
      sum[key] += b[key]
    }
    return sum
  }

  const manualByStart = new Map(
    ((manualRes.data || []) as unknown as Record<string, unknown>[]).map((r) => [r.period_start as string, r])
  )

  return periods.map((p) => {
    const manual = manualByStart.get(p.start)
    const periodDays = dayBuckets.filter((d) => d.start >= p.start && d.start <= p.end)
    const effective = periodDays.map(effectiveForDay).reduce(sumMetrics, metricasEnCero())
    const liveFields = camposCorregibles(effective)

    return {
      period_start: p.start,
      period_end: p.end,
      live: liveFields,
      ...liveFields,
      views_carruseles: effective.views_carruseles,
      chats_abiertos_reel: effective.chats_abiertos_reel,
      chats_abiertos_historia: effective.chats_abiertos_historia,
      conversaciones_reel: effective.conversaciones_reel,
      conversaciones_historia: effective.conversaciones_historia,
      notes: (manual?.notes as string) ?? null,
      overrides: {},
    }
  })
}

// Devuelve el error en vez de lanzarlo: en producción Next reemplaza el
// mensaje de una excepción de server action por uno genérico, y la planilla
// necesita decir en la fila qué pasó. Antes el error se tragaba con un catch
// vacío y la fila mostraba el check verde aunque no se hubiera guardado nada.
export async function saveMetricsOverrides(
  clientId: string,
  periodType: 'daily' | 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
  fields: Partial<Record<OverridableField, number | null>> & { notes?: string | null }
): Promise<{ error: string | null }> {
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

  if (error) {
    console.error('[funnel] saveMetricsOverrides:', error.message)
    return { error: `No se pudo guardar: ${error.message}` }
  }
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}
