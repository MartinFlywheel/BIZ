'use server'

import { createClient } from '@/lib/supabase/server'
import { OVERRIDABLE_FIELDS } from '@/lib/metrics-types'
import { fetchAllRows } from '@/lib/supabase/paginate'

// Live funnel metrics — no manual entry. Sourced from the systems that already
// write these events in real time: content_pieces (Meta sync), interactions
// (ManyChat webhook), agenda_records (Calendly webhook + CRM closing).
export interface PeriodMetrics {
  views_reels: number
  views_historias: number
  chats_abiertos: number
  chats_abiertos_reel: number
  chats_abiertos_historia: number
  conversaciones: number
  conversaciones_reel: number
  conversaciones_historia: number
  agendas: number
  llamadas: number
  llamadas_no_calificadas: number
  shows: number
  cierres: number
  facturacion: number
  cash_collected: number
}

export interface DateBucket {
  key: string
  start: string // YYYY-MM-DD, inclusive
  end: string   // YYYY-MM-DD, inclusive
}

// Matches content_pieces.content_type. "story" is labeled "Historia" in the UI.
export type ContentTypeFilter = 'reel' | 'story'

function emptyMetrics(): PeriodMetrics {
  return {
    views_reels: 0,
    views_historias: 0,
    chats_abiertos: 0,
    chats_abiertos_reel: 0,
    chats_abiertos_historia: 0,
    conversaciones: 0,
    conversaciones_reel: 0,
    conversaciones_historia: 0,
    agendas: 0,
    llamadas: 0,
    llamadas_no_calificadas: 0,
    shows: 0,
    cierres: 0,
    facturacion: 0,
    cash_collected: 0,
  }
}

// Computes live metrics for a client across arbitrary date buckets in a single
// pass. When contentType is given, every stage (views, chats, conversaciones,
// agendas/shows/cierres/facturación) is scoped to that content type — Agendas
// onward are attributed via agenda_records.lead_id -> leads.first_touch_content_id
// -> content_pieces.content_type, so only bookings made after that link was
// added (lead_id populated by the Calendly webhook) can be attributed; older
// agenda_records rows have no lead_id and are excluded from a filtered view.
interface InteractionDayCount {
  day: string
  content_type: string | null
  classification: string | null
  n: number
}

/**
 * Cuántas interacciones hubo por día, tipo de contenido de origen y
 * clasificación.
 *
 * Antes esto se resolvía trayendo TODAS las filas del rango con paginación por
 * OFFSET y contándolas en memoria. En un cliente grande, una página profunda
 * obliga a Postgres a recorrer y descartar decenas de miles de filas antes de
 * devolver las siguientes mil, y esa sentencia sola se pasaba del
 * statement_timeout de 8s: era el 57014 que tumbaba la pestaña Analítica.
 *
 * La agregación vive ahora en la función metrics_interactions_by_day
 * (supabase/044) y devuelve como mucho un par de miles de filas.
 *
 * Si la función todavía no existe en la base, se cae al camino anterior en vez
 * de romper: desplegar código que depende de una migración sin correr es
 * exactamente lo que ya rompió el CRM una vez.
 */
async function interactionCountsByDay(
  clientId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<InteractionDayCount[]> {
  const supabase = await createClient()
  const startIso = `${rangeStart}T00:00:00Z`
  const endIso = `${rangeEnd}T23:59:59Z`

  const { data, error } = await supabase.rpc('metrics_interactions_by_day', {
    p_client_id: clientId,
    p_start: startIso,
    p_end: endIso,
  })

  if (!error && data) {
    return (data as InteractionDayCount[]).map((r) => ({ ...r, n: Number(r.n) || 0 }))
  }

  console.warn('[live-metrics] metrics_interactions_by_day no disponible, usando el camino lento:', error?.message)

  const rows = await fetchAllRows<{ classification: string; bot_triggered_at: string; content_id: string | null }>(
    (from, to) =>
      supabase
        .from('interactions')
        .select('classification, bot_triggered_at, content_id')
        .eq('client_id', clientId)
        .gte('bot_triggered_at', startIso)
        .lte('bot_triggered_at', endIso)
        .range(from, to)
  )

  const ids = Array.from(new Set(rows.map((r) => r.content_id).filter((id): id is string => !!id)))
  let typeById: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: pieces } = await supabase.from('content_pieces').select('id, content_type').in('id', ids)
    typeById = Object.fromEntries((pieces || []).map((p) => [p.id as string, p.content_type as string]))
  }

  // Se agrupa acá para que el resto de la función vea siempre la misma forma.
  const acc = new Map<string, InteractionDayCount>()
  for (const r of rows) {
    const day = r.bot_triggered_at?.slice(0, 10)
    if (!day) continue
    const type = r.content_id ? (typeById[r.content_id] ?? null) : null
    const key = `${day}|${type ?? ''}|${r.classification ?? ''}`
    const prev = acc.get(key)
    if (prev) prev.n += 1
    else acc.set(key, { day, content_type: type, classification: r.classification ?? null, n: 1 })
  }
  return [...acc.values()]
}

export async function getLiveMetricsBuckets(
  clientId: string,
  buckets: DateBucket[],
  contentType?: ContentTypeFilter,
): Promise<Record<string, PeriodMetrics>> {
  const result: Record<string, PeriodMetrics> = {}
  for (const b of buckets) result[b.key] = emptyMetrics()
  if (buckets.length === 0) return result

  const rangeStart = buckets.reduce((min, b) => (b.start < min ? b.start : min), buckets[0].start)
  const rangeEnd = buckets.reduce((max, b) => (b.end > max ? b.end : max), buckets[0].end)

  const supabase = await createClient()

  // None of these can rely on Supabase's default query behavior — each one
  // routinely exceeds the 1000-row cap (see paginate.ts) for active clients,
  // which was silently truncating chats/conversaciones/agendas the wider the
  // selected period got. fetchAllRows pages through with .range() instead.
  const [pieces, interactionCounts, agendas] = await Promise.all([
    fetchAllRows<{ content_type: string; views: number; published_at: string | null }>((from, to) =>
      supabase
        .from('content_pieces')
        .select('content_type, views, published_at')
        .eq('client_id', clientId)
        .gte('published_at', `${rangeStart}T00:00:00Z`)
        .lte('published_at', `${rangeEnd}T23:59:59Z`)
        .range(from, to)
    ),
    interactionCountsByDay(clientId, rangeStart, rangeEnd),
    fetchAllRows<{ fecha_agenda: string; estado: string | null; monto_facturacion: number | null; monto_upfront: number | null; lead_id: string | null }>((from, to) =>
      supabase
        .from('agenda_records')
        .select('fecha_agenda, estado, monto_facturacion, monto_upfront, lead_id')
        .eq('client_id', clientId)
        .gte('fecha_agenda', rangeStart)
        .lte('fecha_agenda', rangeEnd)
        .range(from, to)
    ),
  ])

  function bucketFor(dateStr: string): DateBucket | undefined {
    return buckets.find((b) => dateStr >= b.start && dateStr <= b.end)
  }

  // Resolve reel-vs-historia origin for agenda_records via lead_id -> leads.first_touch_content_id
  let agendaContentTypeByLeadId: Record<string, string> = {}
  if (contentType) {
    const leadIds = Array.from(
      new Set(agendas.map((a) => a.lead_id).filter((id): id is string => !!id))
    )
    if (leadIds.length > 0) {
      const { data: leadsData } = await supabase
        .from('leads')
        .select('id, first_touch_content_id')
        .in('id', leadIds)

      const touchContentIds = Array.from(
        new Set((leadsData || []).map((l) => l.first_touch_content_id).filter((id): id is string => !!id))
      )
      let touchTypeById: Record<string, string> = {}
      if (touchContentIds.length > 0) {
        const { data: touchPieces } = await supabase
          .from('content_pieces')
          .select('id, content_type')
          .in('id', touchContentIds)
        touchTypeById = Object.fromEntries((touchPieces || []).map((p) => [p.id, p.content_type as string]))
      }

      agendaContentTypeByLeadId = Object.fromEntries(
        (leadsData || [])
          .filter((l) => l.first_touch_content_id)
          .map((l) => [l.id as string, touchTypeById[l.first_touch_content_id as string]])
      )
    }
  }

  for (const p of pieces) {
    if (contentType && p.content_type !== contentType) continue
    const date = (p.published_at as string | null)?.slice(0, 10)
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    if (p.content_type === 'reel') r.views_reels += p.views || 0
    else if (p.content_type === 'story') r.views_historias += p.views || 0
  }

  // Mismo cálculo que antes, pero sumando conteos ya agrupados por Postgres en
  // vez de recorrer fila por fila. `n` es cuántas interacciones había en ese
  // día con ese tipo de origen y esa clasificación.
  for (const i of interactionCounts) {
    const interactionType = i.content_type ?? undefined
    if (contentType && interactionType !== contentType) continue
    if (!i.day) continue
    const b = bucketFor(i.day)
    if (!b) continue
    const r = result[b.key]

    r.chats_abiertos += i.n
    if (interactionType === 'reel') r.chats_abiertos_reel += i.n
    else if (interactionType === 'story') r.chats_abiertos_historia += i.n

    if (i.classification === 'conversacion_real' || i.classification === 'lead_calificado') {
      r.conversaciones += i.n
      if (interactionType === 'reel') r.conversaciones_reel += i.n
      else if (interactionType === 'story') r.conversaciones_historia += i.n
    }
  }

  for (const a of agendas) {
    if (contentType) {
      const agendaType = a.lead_id ? agendaContentTypeByLeadId[a.lead_id as string] : undefined
      if (agendaType !== contentType) continue
    }
    const date = a.fecha_agenda as string | null
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    const estado = a.estado as string | null
    r.agendas += 1
    if (estado && ['Show', 'No Show', 'No Cerrado', 'Cerrado', 'No Calificado'].includes(estado)) r.llamadas += 1
    if (estado && ['Show', 'No Cerrado', 'Cerrado'].includes(estado)) r.shows += 1
    if (estado === 'No Calificado') r.llamadas_no_calificadas += 1
    if (estado === 'Cerrado') {
      r.cierres += 1
      r.facturacion += Number(a.monto_facturacion) || 0
      r.cash_collected += Number(a.monto_upfront) || 0
    }
  }

  return result
}

// Convenience wrapper for a single range (dashboard cards, funnel banners).
export async function getLiveMetricsForRange(
  clientId: string,
  start: string,
  end: string,
  contentType?: ContentTypeFilter,
): Promise<PeriodMetrics> {
  const buckets = await getLiveMetricsBuckets(clientId, [{ key: 'range', start, end }], contentType)
  return buckets.range
}

// Wrapped in async only because this file is 'use server' — Next.js requires
// every export from such a file to be an async function, even a pure helper.
export async function dailyBucketsFor(start: string, end: string): Promise<DateBucket[]> {
  const buckets: DateBucket[] = []
  const cursor = new Date(`${start}T12:00:00Z`)
  const endDate = new Date(`${end}T12:00:00Z`)
  while (cursor <= endDate) {
    const date = cursor.toISOString().slice(0, 10)
    buckets.push({ key: date, start: date, end: date })
    cursor.setDate(cursor.getDate() + 1)
  }
  return buckets
}

// Same as getLiveMetricsForRange, but rolls in any manual per-day corrections
// entered in the "Diario" tab of the Contenido register — a fix made there
// shows up everywhere (Analítica KPIs, the sales funnel, health alerts),
// not just in that one spreadsheet. Corrections entered at Semanal/Mensual
// granularity are NOT included here (they only affect that spreadsheet view).
//
// Overrides have no content-type dimension (a Diario correction is a whole-day
// number, not split by reel/historia), so a contentType-filtered view skips
// overrides entirely and returns pure live data for that type.
export async function getEffectiveMetricsForRange(
  clientId: string,
  start: string,
  end: string,
  contentType?: ContentTypeFilter,
): Promise<PeriodMetrics> {
  const dayBuckets = await dailyBucketsFor(start, end)

  if (contentType) {
    const liveByDay = await getLiveMetricsBuckets(clientId, dayBuckets, contentType)
    const total = emptyMetrics()
    for (const day of dayBuckets) {
      const live = liveByDay[day.key]
      for (const key of Object.keys(total) as (keyof PeriodMetrics)[]) {
        total[key] += live[key]
      }
    }
    return total
  }

  const supabase = await createClient()

  const [liveByDay, overridesRes] = await Promise.all([
    getLiveMetricsBuckets(clientId, dayBuckets),
    supabase
      .from('client_metrics')
      .select('period_start, views_reels, views_historias, chats_abiertos, conversaciones, agendas, shows, cierres, facturacion, cash_collected')
      .eq('client_id', clientId)
      .eq('period_type', 'daily')
      .gte('period_start', start)
      .lte('period_start', end),
  ])

  const overridesByDay = new Map(
    (overridesRes.data || []).map((r) => [r.period_start as string, r as Record<string, unknown>])
  )

  const total = emptyMetrics()

  for (const day of dayBuckets) {
    const live = liveByDay[day.key]
    const override = overridesByDay.get(day.key)

    for (const key of Object.keys(total) as (keyof PeriodMetrics)[]) {
      const overrideValue = OVERRIDABLE_FIELDS.includes(key as typeof OVERRIDABLE_FIELDS[number])
        ? (override?.[key] as number | null | undefined)
        : undefined
      total[key] += (overrideValue ?? live[key]) as number
    }
  }

  return total
}
