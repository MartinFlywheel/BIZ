'use server'

import { createClient } from '@/lib/supabase/server'

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
// pass (3 queries total, regardless of bucket count).
export async function getLiveMetricsBuckets(
  clientId: string,
  buckets: DateBucket[],
): Promise<Record<string, PeriodMetrics>> {
  const result: Record<string, PeriodMetrics> = {}
  for (const b of buckets) result[b.key] = emptyMetrics()
  if (buckets.length === 0) return result

  const rangeStart = buckets.reduce((min, b) => (b.start < min ? b.start : min), buckets[0].start)
  const rangeEnd = buckets.reduce((max, b) => (b.end > max ? b.end : max), buckets[0].end)

  const supabase = await createClient()

  const [piecesRes, interactionsRes, agendaRes] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('content_type, views, published_at')
      .eq('client_id', clientId)
      .gte('published_at', `${rangeStart}T00:00:00Z`)
      .lte('published_at', `${rangeEnd}T23:59:59Z`),
    supabase
      .from('interactions')
      .select('classification, bot_triggered_at, content_id')
      .eq('client_id', clientId)
      .gte('bot_triggered_at', `${rangeStart}T00:00:00Z`)
      .lte('bot_triggered_at', `${rangeEnd}T23:59:59Z`),
    supabase
      .from('agenda_records')
      .select('fecha_agenda, estado, monto_facturacion, monto_upfront')
      .eq('client_id', clientId)
      .gte('fecha_agenda', rangeStart)
      .lte('fecha_agenda', rangeEnd),
  ])

  function bucketFor(dateStr: string): DateBucket | undefined {
    return buckets.find((b) => dateStr >= b.start && dateStr <= b.end)
  }

  // Resolve reel-vs-historia origin for interactions via their content_id
  const interactionContentIds = Array.from(
    new Set((interactionsRes.data || []).map((i) => i.content_id).filter((id): id is string => !!id))
  )
  let contentTypeById: Record<string, string> = {}
  if (interactionContentIds.length > 0) {
    const { data: piecesForType } = await supabase
      .from('content_pieces')
      .select('id, content_type')
      .in('id', interactionContentIds)
    contentTypeById = Object.fromEntries((piecesForType || []).map((p) => [p.id, p.content_type as string]))
  }

  for (const p of piecesRes.data || []) {
    const date = (p.published_at as string | null)?.slice(0, 10)
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    if (p.content_type === 'reel') r.views_reels += p.views || 0
    else if (p.content_type === 'story') r.views_historias += p.views || 0
  }

  for (const i of interactionsRes.data || []) {
    const date = (i.bot_triggered_at as string | null)?.slice(0, 10)
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    const contentType = i.content_id ? contentTypeById[i.content_id as string] : undefined

    r.chats_abiertos += 1
    if (contentType === 'reel') r.chats_abiertos_reel += 1
    else if (contentType === 'story') r.chats_abiertos_historia += 1

    if (i.classification === 'conversacion_real') {
      r.conversaciones += 1
      if (contentType === 'reel') r.conversaciones_reel += 1
      else if (contentType === 'story') r.conversaciones_historia += 1
    }
  }

  for (const a of agendaRes.data || []) {
    const date = a.fecha_agenda as string | null
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    const estado = a.estado as string | null
    r.agendas += 1
    if (estado && ['Show', 'No Show', 'Cerrado', 'No Calificado'].includes(estado)) r.llamadas += 1
    if (estado && ['Show', 'Cerrado'].includes(estado)) r.shows += 1
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
): Promise<PeriodMetrics> {
  const buckets = await getLiveMetricsBuckets(clientId, [{ key: 'range', start, end }])
  return buckets.range
}
