'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  COLUMNAS_CORRECCIONES,
  leerCorrecciones,
  ESTADOS_ASISTIO,
  ESTADOS_CON_DESENLACE,
  ESTADO_CERRADO,
  ESTADO_NO_CALIFICADO,
} from '@/lib/metrics-types'
import { fetchAllRows, fetchAllByIds } from '@/lib/supabase/paginate'
import { hoyChile, isoChileDe, minFecha, sumarDias } from '@/lib/fecha-chile'

// Live funnel metrics — no manual entry. Sourced from the systems that already
// write these events in real time: content_pieces (Meta sync), interactions
// (ManyChat webhook), agenda_records (Calendly webhook + CRM closing) e
// ig_account_daily_insights (insights diarios de la cuenta de Instagram).
export interface PeriodMetrics {
  views_reels: number
  // Vistas de por vida de los carruseles y posts (content_type 'post'),
  // asignadas al día de publicación igual que los reels. Antes no se sumaban
  // en ninguna columna aunque sus chats sí entraban en "Chats".
  views_carruseles: number
  views_historias: number
  // Seguidores nuevos del día (follows brutos, FOLLOWER de Meta).
  followers_gained: number
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
  // Agendas que dejaron un abono (monto_upfront > 0) sin quedar en 'Cerrado'.
  // Su abono NO entra a cash_collected, que sigue siendo solo de cierres.
  senados: number
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
    views_carruseles: 0,
    views_historias: 0,
    followers_gained: 0,
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
    senados: 0,
    facturacion: 0,
    cash_collected: 0,
  }
}

/**
 * Monto facturado de una agenda cerrada.
 *
 * El equipo llena casi siempre solo la columna Upfront: con monto_facturacion
 * en NULL, la Facturación del Registro salía en US$ 0 todos los meses mientras
 * el Cash sí tenía valores. Si falta la facturación se usa el upfront, el mismo
 * respaldo que ya aplica content-analytics.ts. Un monto_facturacion puesto a
 * mano (incluido 0) manda.
 */
function montoFacturado(a: { monto_facturacion: number | string | null; monto_upfront: number | string | null }): number {
  if (a.monto_facturacion !== null && a.monto_facturacion !== undefined && a.monto_facturacion !== '') {
    return Number(a.monto_facturacion) || 0
  }
  return Number(a.monto_upfront) || 0
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
  db?: SupabaseClient,
): Promise<InteractionDayCount[]> {
  const supabase = db ?? await createClient()
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
  const pieces = await fetchAllByIds<{ id: string; content_type: string }>(
    ids,
    (chunk) => supabase.from('content_pieces').select('id, content_type').in('id', chunk)
  )
  const typeById: Record<string, string> = Object.fromEntries(
    pieces.map((p) => [p.id, p.content_type])
  )

  // Se agrupa aquí para que el resto de la función vea siempre la misma forma.
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

interface InsightDiario {
  day: string
  views_story: number | null
  follows: number | null
}

// PostgREST responde 42P01 o PGRST205 (según la versión) cuando la tabla no
// existe: es el caso de la 073 todavía sin aplicar.
const TABLA_INEXISTENTE = ['42P01', 'PGRST205']

/**
 * Insights diarios de la cuenta de Instagram (supabase/073, los llena
 * /api/cron/sync-instagram-insights).
 *
 * `disponible` es false si la tabla no existe todavía: en ese caso el resto de
 * las métricas sigue con la ruta anterior (vistas de historias sumadas desde
 * content_pieces y seguidores en 0), en vez de romper la pestaña. Un error
 * inesperado se trata igual y queda en consola: perder este dato un rato es
 * mejor que tumbar Analítica.
 */
async function leerInsightsDiarios(
  clientId: string,
  rangeStart: string,
  rangeEnd: string,
  db?: SupabaseClient,
): Promise<{ disponible: boolean; filas: InsightDiario[] }> {
  const supabase = db ?? await createClient()
  try {
    const filas = await fetchAllRows<InsightDiario>((from, to) =>
      supabase
        .from('ig_account_daily_insights')
        .select('day, views_story, follows')
        .eq('client_id', clientId)
        .gte('day', rangeStart)
        .lte('day', rangeEnd)
        .range(from, to)
    )
    return { disponible: true, filas }
  } catch (e) {
    const code = (e as { code?: string }).code
    if (!code || !TABLA_INEXISTENTE.includes(code)) {
      console.error('[live-metrics] no se pudieron leer los insights diarios de Instagram:', (e as { message?: string }).message)
    }
    return { disponible: false, filas: [] }
  }
}

export interface LiveMetricsDetalle {
  metricas: Record<string, PeriodMetrics>
  // true si ig_account_daily_insights existe, o sea, si la 073 ya se aplicó.
  // Lo necesita leerCorrecciones para saber si un followers_gained = 0 es una
  // corrección de verdad o el DEFAULT viejo.
  insightsDisponibles: boolean
}

export async function getLiveMetricsBuckets(
  clientId: string,
  buckets: DateBucket[],
  contentType?: ContentTypeFilter,
): Promise<Record<string, PeriodMetrics>> {
  return (await getLiveMetricsDetalle(clientId, buckets, contentType)).metricas
}

export async function getLiveMetricsDetalle(
  clientId: string,
  buckets: DateBucket[],
  contentType?: ContentTypeFilter,
  // Solo para tareas programadas (sin sesión): el cliente admin. Desde la app
  // se omite y se usa el de la sesión, con su RLS.
  db?: SupabaseClient,
): Promise<LiveMetricsDetalle> {
  const result: Record<string, PeriodMetrics> = {}
  for (const b of buckets) result[b.key] = emptyMetrics()
  if (buckets.length === 0) return { metricas: result, insightsDisponibles: false }

  const rangeStart = buckets.reduce((min, b) => (b.start < min ? b.start : min), buckets[0].start)
  const rangeEnd = buckets.reduce((max, b) => (b.end > max ? b.end : max), buckets[0].end)

  // Las agendas se agrupan por fecha_agenda, que es el día de la llamada: las
  // pendientes de días que todavía no llegan sumaban al día y al mes en curso
  // (Chat Diario mostraba filas del 15 y 16 con 5 agendas cada una). Nada con
  // fecha posterior a hoy en Chile cuenta como algo que ya pasó.
  const hoy = hoyChile().iso
  const agendasHasta = minFecha(rangeEnd, hoy)

  const supabase = db ?? await createClient()

  // None of these can rely on Supabase's default query behavior — each one
  // routinely exceeds the 1000-row cap (see paginate.ts) for active clients,
  // which was silently truncating chats/conversaciones/agendas the wider the
  // selected period got. fetchAllRows pages through with .range() instead.
  type AgendaFila = {
    fecha_agenda: string
    estado: string | null
    monto_facturacion: number | null
    monto_upfront: number | null
    lead_id: string | null
  }
  const [pieces, interactionCounts, agendas, insights] = await Promise.all([
    fetchAllRows<{ content_type: string; views: number; published_at: string | null }>((from, to) =>
      supabase
        .from('content_pieces')
        .select('content_type, views, published_at')
        .eq('client_id', clientId)
        .gte('published_at', `${rangeStart}T00:00:00Z`)
        .lte('published_at', `${rangeEnd}T23:59:59Z`)
        .range(from, to)
    ),
    interactionCountsByDay(clientId, rangeStart, rangeEnd, db),
    rangeStart <= agendasHasta
      ? fetchAllRows<AgendaFila>((from, to) =>
          supabase
            .from('agenda_records')
            .select('fecha_agenda, estado, monto_facturacion, monto_upfront, lead_id')
            .eq('client_id', clientId)
            .gte('fecha_agenda', rangeStart)
            .lte('fecha_agenda', agendasHasta)
            .range(from, to)
        )
      : Promise.resolve([] as AgendaFila[]),
    // Los insights no tienen dimensión de tipo de contenido para seguidores,
    // y con el filtro 'reel' las historias no cuentan: solo se piden cuando
    // aportan algo a la vista.
    contentType === 'reel'
      ? Promise.resolve({ disponible: false, filas: [] as InsightDiario[] })
      : leerInsightsDiarios(clientId, rangeStart, rangeEnd, db),
  ])

  // Casi todas las llamadas usan buckets de un día: buscar por mapa evita un
  // find lineal por fila, que con rangos de 24 meses ya se nota.
  const bucketPorDia = new Map<string, DateBucket>()
  for (const b of buckets) if (b.start === b.end) bucketPorDia.set(b.start, b)
  const soloDias = bucketPorDia.size === buckets.length

  function bucketFor(dateStr: string): DateBucket | undefined {
    if (soloDias) return bucketPorDia.get(dateStr)
    return buckets.find((b) => dateStr >= b.start && dateStr <= b.end)
  }

  // Resolve reel-vs-historia origin for agenda_records via lead_id -> leads.first_touch_content_id
  let agendaContentTypeByLeadId: Record<string, string> = {}
  if (contentType) {
    const leadIds = Array.from(
      new Set(agendas.map((a) => a.lead_id).filter((id): id is string => !!id))
    )
    if (leadIds.length > 0) {
      // fetchAllByIds y no un .in() suelto: un cliente con más de 1000 agendas
      // en el rango manda más de 1000 ids y PostgREST devuelve solo las
      // primeras 1000, sin error. Las agendas cuyo lead quedaba fuera perdían
      // su tipo de contenido y desaparecían de la vista filtrada por
      // reel/historia.
      const leadsData = await fetchAllByIds<{ id: string; first_touch_content_id: string | null }>(
        leadIds,
        (chunk) => supabase.from('leads').select('id, first_touch_content_id').in('id', chunk)
      )

      const touchContentIds = Array.from(
        new Set(leadsData.map((l) => l.first_touch_content_id).filter((id): id is string => !!id))
      )
      const touchPieces = await fetchAllByIds<{ id: string; content_type: string }>(
        touchContentIds,
        (chunk) => supabase.from('content_pieces').select('id, content_type').in('id', chunk)
      )
      const touchTypeById: Record<string, string> = Object.fromEntries(
        touchPieces.map((p) => [p.id, p.content_type])
      )

      agendaContentTypeByLeadId = Object.fromEntries(
        leadsData
          .filter((l) => l.first_touch_content_id)
          .map((l) => [l.id, touchTypeById[l.first_touch_content_id as string]])
      )
    }
  }

  // ── Vistas de historias y seguidores desde los insights de la cuenta ──────
  // Una sola fuente por día: si ese día tiene views_story de Meta, se usa ese
  // valor y NO se suman las historias sueltas de content_pieces, que antes de
  // arreglar el cron quedaron todas en 0 y pasadas 24 h ya no se pueden
  // recuperar una por una. Los días sin fila siguen con content_pieces.
  //
  // Ojo con el significado: Meta agrupa por día del Pacífico y cuenta las
  // vistas ocurridas ese día, mientras que content_pieces se agrupa por la
  // fecha UTC de publicación. Para historias, que viven 24 h, la diferencia es
  // de unas horas en el borde del día.
  const diasConVistasDeHistorias = new Set<string>()
  for (const fila of insights.filas) {
    const b = bucketFor(fila.day)
    if (!b) continue
    const r = result[b.key]
    if (fila.views_story !== null && fila.views_story !== undefined) {
      diasConVistasDeHistorias.add(fila.day)
      r.views_historias += Number(fila.views_story) || 0
    }
    // Seguidores no tiene tipo de contenido: en una vista filtrada no aplica.
    if (!contentType) r.followers_gained += Number(fila.follows) || 0
  }

  for (const p of pieces) {
    if (contentType && p.content_type !== contentType) continue
    const date = (p.published_at as string | null)?.slice(0, 10)
    if (!date) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    if (p.content_type === 'reel') r.views_reels += p.views || 0
    else if (p.content_type === 'post') r.views_carruseles += p.views || 0
    else if (p.content_type === 'story' && !diasConVistasDeHistorias.has(date)) r.views_historias += p.views || 0
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
    if (!date || date > hoy) continue
    const b = bucketFor(date)
    if (!b) continue
    const r = result[b.key]
    const estado = a.estado as string | null
    r.agendas += 1
    if (estado && (ESTADOS_CON_DESENLACE as readonly string[]).includes(estado)) r.llamadas += 1
    if (estado && (ESTADOS_ASISTIO as readonly string[]).includes(estado)) r.shows += 1
    if (estado === ESTADO_NO_CALIFICADO) r.llamadas_no_calificadas += 1
    if (estado === ESTADO_CERRADO) {
      r.cierres += 1
      r.facturacion += montoFacturado(a)
      r.cash_collected += Number(a.monto_upfront) || 0
    } else if ((Number(a.monto_upfront) || 0) > 0) {
      r.senados += 1
    }
  }

  return { metricas: result, insightsDisponibles: insights.disponible }
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
  for (let date = start; date <= end; date = sumarDias(date, 1)) {
    buckets.push({ key: date, start: date, end: date })
  }
  return buckets
}

/**
 * Inicio del cliente como 'YYYY-MM-DD' en hora de Chile: el mínimo entre la
 * fecha de alta en el CRM, la primera interacción y la primera agenda. Es el
 * límite inferior de las tablas por período y de los selectores de mes.
 *
 * content_pieces queda fuera a propósito: el sync de Instagram trae el
 * historial completo de la cuenta, y un reel de 2025 con 5,5 millones de
 * vistas abría la tabla Mensual en meses en que el cliente ni existía en el
 * CRM e inflaba el TOTAL.
 *
 * null si no se pudo leer nada (por ejemplo, un cliente que RLS no deja ver).
 */
export async function getInicioDelCliente(clientId: string): Promise<string | null> {
  const supabase = await createClient()

  const [cliente, interaccion, agenda] = await Promise.all([
    supabase.from('clients').select('created_at').eq('id', clientId).maybeSingle(),
    supabase
      .from('interactions')
      .select('bot_triggered_at')
      .eq('client_id', clientId)
      .not('bot_triggered_at', 'is', null)
      .order('bot_triggered_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('agenda_records')
      .select('fecha_agenda')
      .eq('client_id', clientId)
      .not('fecha_agenda', 'is', null)
      .order('fecha_agenda', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  for (const r of [cliente, interaccion, agenda]) {
    if (r.error) console.warn('[live-metrics] getInicioDelCliente: una fuente falló:', r.error.message)
  }

  const candidatas = [
    cliente.data?.created_at ? isoChileDe(cliente.data.created_at as string) : null,
    interaccion.data?.bot_triggered_at ? isoChileDe(interaccion.data.bot_triggered_at as string) : null,
    (agenda.data?.fecha_agenda as string | undefined)?.slice(0, 10) ?? null,
  ].filter((f): f is string => !!f)

  if (candidatas.length === 0) return null
  return candidatas.reduce((min, f) => (f < min ? f : min))
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
  // Ver getLiveMetricsDetalle: el cliente admin para el cron de alertas.
  db?: SupabaseClient,
): Promise<PeriodMetrics> {
  // Días que todavía no pasan no se cuentan: el período en curso termina hoy.
  const dayBuckets = await dailyBucketsFor(start, minFecha(end, hoyChile().iso))
  const total = emptyMetrics()
  if (dayBuckets.length === 0) return total

  if (contentType) {
    const liveByDay = (await getLiveMetricsDetalle(clientId, dayBuckets, contentType, db)).metricas
    for (const day of dayBuckets) {
      const live = liveByDay[day.key]
      for (const key of Object.keys(total) as (keyof PeriodMetrics)[]) {
        total[key] += live[key]
      }
    }
    return total
  }

  const supabase = db ?? await createClient()

  const [detalle, overridesRes] = await Promise.all([
    getLiveMetricsDetalle(clientId, dayBuckets, undefined, db),
    supabase
      .from('client_metrics')
      .select(COLUMNAS_CORRECCIONES)
      .eq('client_id', clientId)
      .eq('period_type', 'daily')
      .gte('period_start', start)
      .lte('period_start', end),
  ])

  if (overridesRes.error) {
    console.error('[live-metrics] no se pudieron leer las correcciones del Diario:', overridesRes.error.message)
  }

  const overridesByDay = new Map(
    ((overridesRes.data || []) as unknown as Record<string, unknown>[]).map((r) => [
      r.period_start as string,
      leerCorrecciones(r, detalle.insightsDisponibles),
    ])
  )

  for (const day of dayBuckets) {
    const live = detalle.metricas[day.key]
    const correcciones = overridesByDay.get(day.key) ?? {}

    for (const key of Object.keys(total) as (keyof PeriodMetrics)[]) {
      const corregido = (correcciones as Partial<Record<keyof PeriodMetrics, number>>)[key]
      total[key] += corregido ?? live[key]
    }
  }

  return total
}
