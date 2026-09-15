import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { isoChileDe, sumarDias } from '@/lib/fecha-chile'
import {
  listarPaginaDeReuniones,
  credencialesConfiguradas,
  idDeReunion,
  invitadosExternos,
  type InvitadoFathom,
  type ReunionFathom,
} from './fathom'
import { nombreCoincide, mismoNombre, tokensDeNombre } from './nombres'
import { completarBorradorDeAgenda } from './reporte-llamada'

/**
 * Pega cada grabación de Fathom a la agenda que le corresponde.
 *
 * Cierra el problema con el que empezó todo: la grabación existe, pero vive en
 * Fathom y alguien tiene que traerla a mano para armar el reporte de llamadas.
 *
 * CÓMO FUNCIONA
 * 1. Cada reunión que devuelve la API se guarda en fathom_grabaciones (074),
 *    esté o no asociada. Sin esa tabla (42P01) se sigue por la ruta anterior:
 *    solo se escribe en agenda_records y lo que no se asocia se pierde.
 * 2. Se buscan agendas candidatas sin grabación y no canceladas: con hora a
 *    ±12 h de la reunión, o con fecha a ±1 día de la fecha LOCAL de Chile.
 *    Esto último incluye las agendas cargadas a mano, que no tienen hora y
 *    eran 63 de 76 en Mane.
 * 3. Cada candidata suma puntos (ver puntuarCandidata). Se asocia sola con 60
 *    o más y 20 de ventaja sobre la segunda; si no, queda como sugerencia para
 *    que alguien la asocie desde la pestaña Llamadas.
 * 4. Las grabaciones sin agenda de los últimos 30 días se reintentan en cada
 *    vuelta: la agenda puede cargarse días después de la llamada.
 *
 * DE QUÉ CLIENTE ES CADA GRABACIÓN
 * Hay una sola FATHOM_API_KEY y es por usuario, así que la API no dice de qué
 * cliente es cada reunión. Se deduce de las agendas candidatas: si la mejor es
 * de Mane, la grabación es de Mane. Las candidatas de dos clientes a la misma
 * hora se anulan entre sí (ninguna saca ventaja) y quedan como sugerencia.
 * Sin candidatas, solo se asigna cliente si hay exactamente uno con calendario
 * conectado y la reunión tiene invitados externos. Con un segundo cliente
 * grabando habrá que agregar una key por cliente o una lista de grabadores.
 */

type Supabase = ReturnType<typeof createAdminClient>
// Las acciones de la pestaña Llamadas escriben con el cliente de la sesión
// (RLS de agencia), que tiene otro tipo que el admin.
type ClienteSupabase = SupabaseClient

const TABLA_INEXISTENTE = '42P01'
const COLUMNA_INEXISTENTE = '42703'
const VIOLA_UNICO = '23505'
const FALTA_MIGRACION = 'Falta correr la migración 052-fathom-grabaciones.sql o la 055'

/**
 * Cuánto hacia atrás pedir grabaciones a la API en la corrida normal. Una
 * llamada puede tardar en procesarse y el cron puede haber estado caído un par
 * de días. Lo más viejo se cubre con el reintento sobre la tabla y el backfill.
 */
const DIAS_HACIA_ATRAS = 7

/** Cuántos días se reintentan las grabaciones guardadas sin agenda. */
const DIAS_REINTENTO = 30

/**
 * Solo las llamadas de las últimas dos semanas generan borrador de reporte.
 * Un backfill de julio no puede llenar el popup de tareas de aprobación ni
 * gastar una llamada al modelo por cada reunión vieja.
 */
export const DIAS_BORRADOR = 14

const VENTANA_HORAS = 12
export const PUNTAJE_AUTO = 60
export const VENTAJA_MINIMA = 20
export const PUNTAJE_SUGERENCIA = 40

export interface ResumenFathom {
  reunionesRevisadas: number
  /** Filas escritas en fathom_grabaciones. */
  guardadas: number
  enganchadas: number
  /** Ya estaban asociadas a una agenda antes de esta vuelta. */
  yaTenian: number
  /** Hay candidata pero sin certeza: quedan como sugerencia. */
  ambiguas: number
  /** Ninguna agenda se parece lo suficiente. */
  sinAgenda: number
  /** Grabaciones guardadas sin agenda que se volvieron a intentar. */
  reintentadas: number
  borradores: number
  errores: number
  error: string | null
}

export type DecisionFathom = 'ya_tenia' | 'auto' | 'sugerida' | 'sin_agenda' | 'error'

export interface DetalleFathom {
  recordingId: string
  titulo: string | null
  cuando: string | null
  decision: DecisionFathom
  agendaId: string | null
  puntaje: number | null
  motivo: string
}

/** Una grabación, venga de la API o de la tabla. */
export interface Grabacion {
  recordingId: string
  clientId: string | null
  agendaId: string | null
  matchMetodo: string | null
  matchPuntaje: number | null
  sugeridaAgendaId: string | null
  titulo: string | null
  shareUrl: string | null
  url: string | null
  programada: string | null
  inicio: string | null
  fin: string | null
  creadaEnFathom: string | null
  grabadoPorEmail: string | null
  grabadoPorNombre: string | null
  invitados: InvitadoFathom[]
  resumen: string | null
}

export interface AgendaCandidata {
  id: string
  client_id: string
  lead_id: string | null
  hora_agenda: string | null
  fecha_agenda: string | null
  email_lead: string | null
  nombre_lead: string | null
  closer: string | null
  estado: string | null
  google_event_id: string | null
  fathom_recording_id: string | null
  lead_nombre: string | null
  lead_email: string | null
}

export interface CandidataPuntuada {
  agenda: AgendaCandidata
  puntaje: number
  motivos: string[]
}

export interface Evaluacion {
  decision: 'auto' | 'sugerida' | 'sin_agenda'
  elegida: CandidataPuntuada | null
  rival: CandidataPuntuada | null
  candidatas: CandidataPuntuada[]
  motivo: string
}

function faltaTabla(error: { code?: string } | null | undefined): boolean {
  return error?.code === TABLA_INEXISTENTE
}

export function grabacionDesdeReunion(r: ReunionFathom): Grabacion | null {
  const recordingId = idDeReunion(r)
  if (!recordingId) return null
  return {
    recordingId,
    clientId: null,
    agendaId: null,
    matchMetodo: null,
    matchPuntaje: null,
    sugeridaAgendaId: null,
    titulo: r.meeting_title ?? r.title ?? null,
    shareUrl: r.share_url ?? null,
    url: r.url ?? null,
    programada: r.scheduled_start_time ?? null,
    inicio: r.recording_start_time ?? null,
    fin: r.recording_end_time ?? null,
    creadaEnFathom: r.created_at ?? null,
    grabadoPorEmail: r.recorded_by?.email?.toLowerCase() ?? null,
    grabadoPorNombre: r.recorded_by?.name ?? null,
    invitados: (r.calendar_invitees ?? []).map((i) => ({
      name: i.name ?? null,
      email: i.email?.toLowerCase() ?? null,
      email_domain: i.email_domain ?? null,
      is_external: i.is_external ?? null,
    })),
    resumen: r.default_summary?.markdown_formatted ?? null,
  }
}

/** Columnas de fathom_grabaciones que se leen para reconstruir una grabación. */
export const COLUMNAS_GRABACION =
  'recording_id, client_id, agenda_record_id, match_metodo, match_puntaje, sugerida_agenda_id, titulo, share_url, url, scheduled_start_time, recording_start_time, recording_end_time, creada_en_fathom, grabado_por_email, grabado_por_nombre, invitados, resumen'

export function grabacionDesdeFila(f: Record<string, unknown>): Grabacion {
  const texto = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    recordingId: String(f.recording_id),
    clientId: texto(f.client_id),
    agendaId: texto(f.agenda_record_id),
    matchMetodo: texto(f.match_metodo),
    matchPuntaje: typeof f.match_puntaje === 'number' ? f.match_puntaje : null,
    sugeridaAgendaId: texto(f.sugerida_agenda_id),
    titulo: texto(f.titulo),
    shareUrl: texto(f.share_url),
    url: texto(f.url),
    programada: texto(f.scheduled_start_time),
    inicio: texto(f.recording_start_time),
    fin: texto(f.recording_end_time),
    creadaEnFathom: texto(f.creada_en_fathom),
    grabadoPorEmail: texto(f.grabado_por_email),
    grabadoPorNombre: texto(f.grabado_por_nombre),
    invitados: Array.isArray(f.invitados) ? (f.invitados as InvitadoFathom[]) : [],
    resumen: texto(f.resumen),
  }
}

/**
 * Lo que viene de Fathom. No incluye client_id, agenda ni el resultado del
 * cruce: el upsert no debe pisar una asociación hecha a mano.
 */
function filaDesdeGrabacion(g: Grabacion): Record<string, unknown> {
  return {
    recording_id: g.recordingId,
    titulo: g.titulo,
    share_url: g.shareUrl,
    url: g.url,
    scheduled_start_time: g.programada,
    recording_start_time: g.inicio,
    recording_end_time: g.fin,
    creada_en_fathom: g.creadaEnFathom,
    grabado_por_email: g.grabadoPorEmail,
    grabado_por_nombre: g.grabadoPorNombre,
    invitados: g.invitados,
    resumen: g.resumen,
    sincronizado_at: new Date().toISOString(),
  }
}

/** La hora de referencia de la grabación: la agendada, o cuándo empezó a grabar. */
export function momentoDe(g: Pick<Grabacion, 'programada' | 'inicio' | 'creadaEnFathom'>): string | null {
  return g.programada ?? g.inicio ?? g.creadaEnFathom
}

export function esReciente(g: Grabacion, dias = DIAS_BORRADOR): boolean {
  const m = momentoDe(g)
  if (!m) return false
  return Date.now() - new Date(m).getTime() <= dias * 86_400_000
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000)
}

function parecido(closer: string | null, grabador: string | null): boolean {
  const a = tokensDeNombre(closer)
  const b = tokensDeNombre(grabador)
  return a.length > 0 && b.length > 0 && a[0] === b[0]
}

/**
 * Cuánto se parece una agenda a una grabación. Null si está fuera de la ventana.
 *
 *   hora a ≤10 min de la reunión            +60  (salen del mismo evento)
 *   hora a ≤90 min                          +40  (reprogramada sin sincronizar)
 *   correo del invitado = el de la agenda   +40
 *   misma fecha local, agenda sin hora      +15
 *   nombre de la agenda en invitado/título  +30
 *   closer ≈ quien grabó                    +10
 *
 * Con estos pesos, una agenda manual sin hora ni correo llega a 55 como mucho:
 * queda como sugerencia y no se asocia sola. Es a propósito. Pegarle la
 * grabación a la agenda equivocada manda un reporte erróneo a marketing sin
 * que nadie lo note.
 */
export function puntuarCandidata(g: Grabacion, a: AgendaCandidata): CandidataPuntuada | null {
  const momento = momentoDe(g)
  if (!momento) return null
  const t = new Date(momento).getTime()
  if (Number.isNaN(t)) return null

  const fechaLocal = isoChileDe(momento)
  const tHora = a.hora_agenda ? new Date(a.hora_agenda).getTime() : NaN
  const dentroPorHora = !Number.isNaN(tHora) && Math.abs(tHora - t) <= VENTANA_HORAS * 3_600_000
  const dentroPorFecha = !!a.fecha_agenda && Math.abs(diasEntre(a.fecha_agenda, fechaLocal)) <= 1
  if (!dentroPorHora && !dentroPorFecha) return null

  let puntaje = 0
  const motivos: string[] = []

  if (!Number.isNaN(tHora)) {
    // La reunión puede no tener hora agendada (grabación iniciada a mano): se
    // toma la más cercana de las dos que haya.
    const minutos = Math.min(
      ...[g.programada, g.inicio]
        .filter((v): v is string => !!v)
        .map((v) => Math.abs(new Date(v).getTime() - tHora) / 60_000)
    )
    if (minutos <= 10) {
      puntaje += 60
      motivos.push(`hora a ${Math.round(minutos)} min (+60)`)
    } else if (minutos <= 90) {
      puntaje += 40
      motivos.push(`hora a ${Math.round(minutos)} min (+40)`)
    } else {
      motivos.push(`hora a ${Math.round(minutos)} min (0)`)
    }
  } else if (a.fecha_agenda === fechaLocal) {
    puntaje += 15
    motivos.push('misma fecha, agenda sin hora (+15)')
  }

  const externos = invitadosExternos(g.invitados)
  const correos = externos.map((i) => i.email?.toLowerCase()).filter((c): c is string => !!c)
  const correosAgenda = [a.email_lead, a.lead_email].map((c) => c?.trim().toLowerCase()).filter((c): c is string => !!c)
  if (correosAgenda.some((c) => correos.includes(c))) {
    puntaje += 40
    motivos.push('correo del invitado (+40)')
  }

  // El título de Calendly es "{invitado} and {anfitrión}"; se excluye el nombre
  // de quien grabó para que el anfitrión no cuente como coincidencia.
  const textos = [...externos.map((i) => i.name), g.titulo]
  const excluir = [g.grabadoPorNombre]
  if (
    nombreCoincide(a.nombre_lead, textos, excluir) ||
    nombreCoincide(a.lead_nombre, textos, excluir)
  ) {
    puntaje += 30
    motivos.push('nombre (+30)')
  }

  if (parecido(a.closer, g.grabadoPorNombre)) {
    puntaje += 10
    motivos.push('closer = quien grabó (+10)')
  }

  return { agenda: a, puntaje, motivos }
}

/**
 * Dos filas de agenda que son la misma llamada: la cargada a mano y la que
 * trajo el calendario, mismo día y mismo lead o nombre. No son rivales entre
 * sí; se prefiere la que el equipo ya trabajó (closer o estado).
 */
function sonGemelas(a: AgendaCandidata, b: AgendaCandidata): boolean {
  if (a.client_id !== b.client_id || !a.fecha_agenda || a.fecha_agenda !== b.fecha_agenda) return false
  if (!!a.google_event_id === !!b.google_event_id) return false
  if (a.lead_id && a.lead_id === b.lead_id) return true
  return mismoNombre(a.nombre_lead, b.nombre_lead)
}

function trabajada(a: AgendaCandidata): boolean {
  return !!a.closer?.trim() || (!!a.estado && a.estado !== 'Pendiente')
}

export function evaluarGrabacion(g: Grabacion, agendas: AgendaCandidata[]): Evaluacion {
  const candidatas = agendas
    .map((a) => puntuarCandidata(g, a))
    .filter((c): c is CandidataPuntuada => !!c && c.puntaje > 0)
    .sort((x, y) => y.puntaje - x.puntaje)

  if (candidatas.length === 0) {
    return { decision: 'sin_agenda', elegida: null, rival: null, candidatas, motivo: 'ninguna agenda en la ventana suma puntos' }
  }

  let elegida = candidatas[0]
  const gemela = candidatas.slice(1).find((c) => sonGemelas(c.agenda, elegida.agenda))
  if (gemela && trabajada(gemela.agenda) && !trabajada(elegida.agenda)) {
    // Misma llamada: la grabación va a la fila que tiene closer y estado, con
    // el puntaje de la que la identificó.
    elegida = { agenda: gemela.agenda, puntaje: elegida.puntaje, motivos: [...elegida.motivos, 'fila manual gemela'] }
  }
  const rival = candidatas.find((c) => c.agenda.id !== elegida.agenda.id && !sonGemelas(c.agenda, elegida.agenda)) ?? null

  if (elegida.puntaje >= PUNTAJE_AUTO && (!rival || elegida.puntaje - rival.puntaje >= VENTAJA_MINIMA)) {
    return { decision: 'auto', elegida, rival, candidatas, motivo: elegida.motivos.join(', ') }
  }

  if (elegida.puntaje >= PUNTAJE_SUGERENCIA) {
    const motivo = elegida.puntaje < PUNTAJE_AUTO
      ? `puntaje ${elegida.puntaje} bajo ${PUNTAJE_AUTO}`
      : `ventaja de ${elegida.puntaje - (rival?.puntaje ?? 0)} sobre la segunda, se piden ${VENTAJA_MINIMA}`
    return { decision: 'sugerida', elegida, rival, candidatas, motivo }
  }

  return {
    decision: 'sin_agenda',
    elegida: null,
    rival,
    candidatas,
    motivo: `la mejor candidata suma ${elegida.puntaje}, se piden ${PUNTAJE_SUGERENCIA} para sugerirla`,
  }
}

interface FilaAgenda {
  id: string
  client_id: string
  lead_id: string | null
  hora_agenda: string | null
  fecha_agenda: string | null
  email_lead: string | null
  nombre_lead: string | null
  closer: string | null
  estado: string | null
  google_event_id: string | null
  fathom_recording_id: string | null
  cancelada_at: string | null
  leads: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
}

/**
 * Las agendas que podrían corresponder a alguna de las grabaciones.
 *
 * Una sola consulta para todo el lote: con hora en la ventana de horas o con
 * fecha en la ventana de días. El cruce fino se hace en memoria.
 */
export async function cargarCandidatas(
  supabase: ClienteSupabase,
  grabaciones: Grabacion[],
  opciones: { incluirConGrabacion?: boolean } = {}
): Promise<{ agendas: AgendaCandidata[]; error: { code?: string; message: string } | null }> {
  const tiempos = grabaciones
    .map((g) => momentoDe(g))
    .filter((m): m is string => !!m)
    .map((m) => new Date(m).getTime())
    .filter((t) => !Number.isNaN(t))
  if (tiempos.length === 0) return { agendas: [], error: null }

  const min = Math.min(...tiempos)
  const max = Math.max(...tiempos)
  const desdeHora = new Date(min - VENTANA_HORAS * 3_600_000).toISOString()
  const hastaHora = new Date(max + VENTANA_HORAS * 3_600_000).toISOString()
  const desdeFecha = sumarDias(isoChileDe(new Date(min)), -1)
  const hastaFecha = sumarDias(isoChileDe(new Date(max)), 1)

  const agendas: AgendaCandidata[] = []
  const PAGINA = 1000
  for (let desde = 0; ; desde += PAGINA) {
    let query = supabase
      .from('agenda_records')
      .select('id, client_id, lead_id, hora_agenda, fecha_agenda, email_lead, nombre_lead, closer, estado, google_event_id, fathom_recording_id, cancelada_at, leads(full_name, email)')
      .or(
        `and(hora_agenda.gte."${desdeHora}",hora_agenda.lte."${hastaHora}"),and(fecha_agenda.gte.${desdeFecha},fecha_agenda.lte.${hastaFecha})`
      )
      .is('cancelada_at', null)
      .order('id')
      .range(desde, desde + PAGINA - 1)
    if (!opciones.incluirConGrabacion) query = query.is('fathom_recording_id', null)

    const { data, error } = await query
    if (error) return { agendas, error }

    for (const fila of (data ?? []) as unknown as FilaAgenda[]) {
      const lead = Array.isArray(fila.leads) ? fila.leads[0] ?? null : fila.leads
      agendas.push({
        id: fila.id,
        client_id: fila.client_id,
        lead_id: fila.lead_id,
        hora_agenda: fila.hora_agenda,
        fecha_agenda: fila.fecha_agenda,
        email_lead: fila.email_lead,
        nombre_lead: fila.nombre_lead,
        closer: fila.closer,
        estado: fila.estado,
        google_event_id: fila.google_event_id,
        fathom_recording_id: fila.fathom_recording_id,
        lead_nombre: lead?.full_name ?? null,
        lead_email: lead?.email ?? null,
      })
    }
    if (!data || data.length < PAGINA) break
  }

  return { agendas, error: null }
}

function esEnlaceReemplazable(link: string | null): boolean {
  if (!link?.trim()) return true
  // Enlaces que escribió el propio CRM: una grabación anterior de Fathom o la
  // URI de Calendly que el webhook viejo guardaba aquí por error.
  return /fathom\.video/i.test(link) || /api\.calendly\.com/i.test(link)
}

export interface ResultadoEnlace {
  ok: boolean
  error?: string
  reciente: boolean
  clientId: string | null
}

/**
 * Asocia una grabación a una agenda: la usan el sync y la pestaña Llamadas.
 *
 * El resumen se copia a agenda_records solo en llamadas recientes (o si no
 * existe la tabla nueva, donde no hay otro lugar para guardarlo). En una
 * llamada vieja el resumen queda en fathom_grabaciones y la pestaña lo muestra
 * desde ahí; copiarlo haría que el barrido de triaje cree tareas de aprobación
 * de reportes de hace meses.
 */
export async function enlazarGrabacion(
  supabase: ClienteSupabase,
  g: Grabacion,
  agendaId: string,
  opciones: { metodo: 'auto' | 'manual'; puntaje: number | null; tabla: boolean }
): Promise<ResultadoEnlace> {
  const reciente = esReciente(g)
  const { data: agenda, error: errorAgenda } = await supabase
    .from('agenda_records')
    .select('id, client_id, fathom_recording_id, fathom_resumen, fathom_sincronizado_at, link_reporte')
    .eq('id', agendaId)
    .maybeSingle()

  if (errorAgenda) return { ok: false, error: errorAgenda.message, reciente, clientId: null }
  if (!agenda) return { ok: false, error: 'No se encontró la agenda.', reciente, clientId: null }
  if (agenda.fathom_recording_id && String(agenda.fathom_recording_id) !== g.recordingId) {
    return { ok: false, error: 'La agenda ya tiene otra grabación asociada. Desasóciala primero.', reciente, clientId: agenda.client_id }
  }

  const cambios: Record<string, unknown> = {
    fathom_recording_id: g.recordingId,
    fathom_sincronizado_at: new Date().toISOString(),
  }
  if (!opciones.tabla || reciente) cambios.fathom_resumen = g.resumen
  const enlace = g.shareUrl ?? g.url
  if (enlace && esEnlaceReemplazable(agenda.link_reporte as string | null)) cambios.link_reporte = enlace

  const { error } = await supabase.from('agenda_records').update(cambios).eq('id', agendaId)
  if (error) {
    const mensaje = error.code === VIOLA_UNICO
      ? 'Esa grabación ya está asociada a otra agenda del cliente.'
      : error.message
    return { ok: false, error: mensaje, reciente, clientId: agenda.client_id }
  }

  if (opciones.tabla) {
    const { error: errorGrabacion } = await supabase
      .from('fathom_grabaciones')
      .update({
        agenda_record_id: agendaId,
        client_id: agenda.client_id,
        match_metodo: opciones.metodo,
        match_puntaje: opciones.puntaje,
        sugerida_agenda_id: null,
      })
      .eq('recording_id', g.recordingId)

    if (errorGrabacion && !faltaTabla(errorGrabacion)) {
      // La agenda ya tenía otra grabación en la tabla (índice único). Se
      // deshace lo escrito en la agenda para no dejar las dos tablas en
      // desacuerdo.
      await supabase
        .from('agenda_records')
        .update({
          fathom_recording_id: agenda.fathom_recording_id,
          fathom_resumen: agenda.fathom_resumen,
          fathom_sincronizado_at: agenda.fathom_sincronizado_at,
          link_reporte: agenda.link_reporte,
        })
        .eq('id', agendaId)
      const mensaje = errorGrabacion.code === VIOLA_UNICO
        ? 'La agenda ya tiene otra grabación asociada. Desasóciala primero.'
        : errorGrabacion.message
      return { ok: false, error: mensaje, reciente, clientId: agenda.client_id }
    }
  }

  return { ok: true, reciente, clientId: agenda.client_id }
}

/**
 * Separa una grabación de su agenda. La marca como "desasociada" para que el
 * sync no la vuelva a pegar sola a la misma agenda en la vuelta siguiente.
 */
export async function desenlazarGrabacion(
  supabase: ClienteSupabase,
  recordingId: string
): Promise<{ ok: boolean; error?: string; clientId: string | null }> {
  const { data: fila, error } = await supabase
    .from('fathom_grabaciones')
    .select('recording_id, client_id, agenda_record_id, share_url, url')
    .eq('recording_id', recordingId)
    .maybeSingle()

  if (faltaTabla(error)) return { ok: false, error: 'Falta correr la migración 074-grabaciones-fathom-y-llamadas.sql.', clientId: null }
  if (error) return { ok: false, error: error.message, clientId: null }
  if (!fila) return { ok: false, error: 'No se encontró la grabación.', clientId: null }

  // Por recording_id y no por id de agenda: cubre también una asociación que
  // quedó solo en agenda_records (anterior a la tabla).
  const { data: agendas } = await supabase
    .from('agenda_records')
    .select('id, link_reporte, reporte_estado')
    .eq('fathom_recording_id', recordingId)

  for (const a of agendas ?? []) {
    const link = a.link_reporte as string | null
    const cambios: Record<string, unknown> = {
      fathom_recording_id: null,
      fathom_resumen: null,
      fathom_sincronizado_at: null,
    }
    if (link && (link === fila.share_url || link === fila.url)) cambios.link_reporte = null
    // Un borrador armado con el resumen de otra llamada no sirve; uno aprobado
    // ya lo revisó una persona y se respeta.
    if (a.reporte_estado === 'borrador') cambios.reporte_estado = null
    const { error: errorAgenda } = await supabase.from('agenda_records').update(cambios).eq('id', a.id)
    if (errorAgenda) return { ok: false, error: errorAgenda.message, clientId: fila.client_id as string | null }

    const { error: errorTareas } = await supabase
      .from('system_tasks')
      .update({ estado: 'descartada' })
      .eq('agenda_record_id', a.id)
      .eq('tipo', 'reporte_llamada')
      .eq('estado', 'pendiente')
    if (errorTareas && !faltaTabla(errorTareas)) {
      console.error(`[fathom-sync] no se descartó la tarea de reporte de ${a.id}: ${errorTareas.message}`)
    }
  }

  const { error: errorGrabacion } = await supabase
    .from('fathom_grabaciones')
    .update({ agenda_record_id: null, match_metodo: 'desasociada', match_puntaje: null, sugerida_agenda_id: null })
    .eq('recording_id', recordingId)
  if (errorGrabacion) return { ok: false, error: errorGrabacion.message, clientId: fila.client_id as string | null }

  return { ok: true, clientId: fila.client_id as string | null }
}

function partir<T>(lista: T[], tamano: number): T[][] {
  const partes: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) partes.push(lista.slice(i, i + tamano))
  return partes
}

export interface OpcionesSync {
  /** Desde cuándo pedir reuniones a la API. Por defecto, 7 días. */
  desde?: Date
  hasta?: Date | null
  cursor?: string | null
  maxPaginas?: number
  /** Reuniones ya en mano (webhook): no se llama a la API. */
  reuniones?: ReunionFathom[]
  /** Reintentar las grabaciones guardadas sin agenda. Por defecto, sí. */
  reintentar?: boolean
  /** No escribe nada: devuelve lo que haría. */
  dry?: boolean
}

export interface ResultadoSync {
  ok: boolean
  motivo?: string
  resumen: ResumenFathom
  detalle: DetalleFathom[]
  siguienteCursor: string | null
}

/**
 * Trae las grabaciones, las guarda y las engancha.
 *
 * Recorre las grabaciones una vez y las cruza contra las agendas candidatas en
 * memoria: son decenas de filas, no miles, y hacerlo así evita una consulta
 * por reunión.
 */
export async function sincronizarFathom(opciones: OpcionesSync = {}): Promise<ResultadoSync> {
  const resumen: ResumenFathom = {
    reunionesRevisadas: 0,
    guardadas: 0,
    enganchadas: 0,
    yaTenian: 0,
    ambiguas: 0,
    sinAgenda: 0,
    reintentadas: 0,
    borradores: 0,
    errores: 0,
    error: null,
  }
  const detalle: DetalleFathom[] = []
  let siguienteCursor: string | null = null
  const dry = !!opciones.dry

  if (!opciones.reuniones && !credencialesConfiguradas()) {
    return { ok: false, motivo: 'Falta FATHOM_API_KEY', resumen, detalle, siguienteCursor }
  }

  const supabase = createAdminClient()
  const anotar = (g: Grabacion, decision: DecisionFathom, agendaId: string | null, puntaje: number | null, motivo: string) => {
    detalle.push({ recordingId: g.recordingId, titulo: g.titulo, cuando: momentoDe(g), decision, agendaId, puntaje, motivo })
  }

  try {
    let reuniones = opciones.reuniones
    if (!reuniones) {
      const pagina = await listarPaginaDeReuniones({
        desde: opciones.desde ?? new Date(Date.now() - DIAS_HACIA_ATRAS * 86_400_000),
        hasta: opciones.hasta,
        cursor: opciones.cursor,
        maxPaginas: opciones.maxPaginas,
      })
      reuniones = pagina.reuniones
      siguienteCursor = pagina.siguienteCursor
    }
    resumen.reunionesRevisadas = reuniones.length

    // Sin repetir: la API puede devolver la misma reunión en dos páginas si
    // entra una nueva mientras se pagina.
    const porId = new Map<string, Grabacion>()
    for (const r of reuniones) {
      const g = grabacionDesdeReunion(r)
      if (g) porId.set(g.recordingId, g)
    }
    const nuevas = [...porId.values()]
    const ids = nuevas.map((g) => g.recordingId)

    // ¿Existe la tabla de la 074?
    const sonda = await supabase.from('fathom_grabaciones').select('recording_id').limit(1)
    let tabla = !faltaTabla(sonda.error)
    if (sonda.error && tabla) throw sonda.error

    // Lo que ya estaba asociado, en agenda_records y en la tabla. Siempre como
    // texto: el recording_id que llega como número nunca coincidía.
    const agendaPorGrabacion = new Map<string, string>()
    const filaPorGrabacion = new Map<string, Grabacion>()
    for (const parte of partir(ids, 100)) {
      const { data, error } = await supabase
        .from('agenda_records')
        .select('id, fathom_recording_id')
        .in('fathom_recording_id', parte)
      if (error) {
        return {
          ok: false,
          motivo: error.code === COLUMNA_INEXISTENTE ? FALTA_MIGRACION : error.message,
          resumen, detalle, siguienteCursor,
        }
      }
      for (const a of data ?? []) agendaPorGrabacion.set(String(a.fathom_recording_id), a.id as string)

      if (tabla) {
        const { data: filas, error: errorFilas } = await supabase
          .from('fathom_grabaciones')
          .select(COLUMNAS_GRABACION)
          .in('recording_id', parte)
        if (errorFilas) throw errorFilas
        for (const f of filas ?? []) {
          const g = grabacionDesdeFila(f as Record<string, unknown>)
          filaPorGrabacion.set(g.recordingId, g)
        }
      }
    }

    // Guardar todo lo que trajo la API, asociado o no.
    if (tabla && !dry && nuevas.length > 0) {
      for (const parte of partir(nuevas, 100)) {
        const { error } = await supabase
          .from('fathom_grabaciones')
          .upsert(parte.map(filaDesdeGrabacion), { onConflict: 'recording_id' })
        if (error) {
          if (faltaTabla(error)) { tabla = false; break }
          throw error
        }
        resumen.guardadas += parte.length
      }
    }

    const pendientes: Grabacion[] = []
    for (const g of nuevas) {
      const fila = filaPorGrabacion.get(g.recordingId)
      const agendaId = agendaPorGrabacion.get(g.recordingId) ?? fila?.agendaId ?? null
      if (agendaId) {
        resumen.yaTenian++
        anotar(g, 'ya_tenia', agendaId, fila?.matchPuntaje ?? null, 'ya estaba asociada')
        // Asociada antes de que existiera la tabla: se deja constancia en la fila.
        if (tabla && !dry && fila?.agendaId !== agendaId && agendaPorGrabacion.has(g.recordingId)) {
          const { data: agenda } = await supabase.from('agenda_records').select('client_id').eq('id', agendaId).maybeSingle()
          const { error } = await supabase
            .from('fathom_grabaciones')
            .update({ agenda_record_id: agendaId, client_id: agenda?.client_id ?? null, match_metodo: 'previa', sugerida_agenda_id: null })
            .eq('recording_id', g.recordingId)
          if (error) console.error(`[fathom-sync] no se registró la asociación previa de ${g.recordingId}: ${error.message}`)
        }
        continue
      }
      if (fila?.matchMetodo === 'desasociada') {
        resumen.sinAgenda++
        anotar(g, 'sin_agenda', null, null, 'alguien la desasoció a mano; solo se asocia desde la pestaña Llamadas')
        continue
      }
      pendientes.push({
        ...g,
        clientId: fila?.clientId ?? null,
        matchMetodo: fila?.matchMetodo ?? null,
        matchPuntaje: fila?.matchPuntaje ?? null,
        sugeridaAgendaId: fila?.sugeridaAgendaId ?? null,
      })
    }

    // Reintento: las guardadas sin agenda de los últimos 30 días. La agenda
    // manual puede cargarse días después de la llamada.
    if (tabla && opciones.reintentar !== false) {
      const limiteMs = Date.now() - DIAS_REINTENTO * 86_400_000
      const limite = new Date(limiteMs).toISOString()
      const { data: viejas, error } = await supabase
        .from('fathom_grabaciones')
        .select(COLUMNAS_GRABACION)
        .is('agenda_record_id', null)
        .gte('sincronizado_at', limite)
        .order('recording_start_time', { ascending: false, nullsFirst: false })
        .limit(200)
      if (error) throw error
      const yaEnLista = new Set(ids)
      for (const f of viejas ?? []) {
        const g = grabacionDesdeFila(f as Record<string, unknown>)
        if (yaEnLista.has(g.recordingId) || g.matchMetodo === 'desasociada') continue
        const m = momentoDe(g)
        // sincronizado_at se renueva con cada backfill: lo que manda es la
        // fecha de la llamada, no la de la última lectura.
        if (m && new Date(m).getTime() < limiteMs) continue
        pendientes.push(g)
        resumen.reintentadas++
      }
    }

    if (pendientes.length === 0) return { ok: true, resumen, detalle, siguienteCursor }

    const { agendas, error: errorCandidatas } = await cargarCandidatas(supabase, pendientes)
    if (errorCandidatas) {
      return {
        ok: false,
        motivo: errorCandidatas.code === COLUMNA_INEXISTENTE ? FALTA_MIGRACION : errorCandidatas.message,
        resumen, detalle, siguienteCursor,
      }
    }

    // Respaldo para asignar cliente cuando no hay candidatas (ver arriba).
    const { data: conCalendario } = await supabase.from('clients').select('id').not('google_calendar_id', 'is', null)
    const clienteUnico = conCalendario?.length === 1 ? (conCalendario[0].id as string) : null

    // Primero las que tienen el cruce más claro: así una agenda en disputa se
    // la lleva la grabación que mejor la identifica.
    const ordenadas = pendientes
      .map((g) => ({ g, mejor: evaluarGrabacion(g, agendas).elegida?.puntaje ?? 0 }))
      .sort((a, b) => b.mejor - a.mejor)
      .map((x) => x.g)

    const usadas = new Set<string>()
    for (const g of ordenadas) {
      const disponibles = agendas.filter((a) => !usadas.has(a.id))
      const ev = evaluarGrabacion(g, disponibles)

      if (ev.decision === 'auto' && ev.elegida) {
        const agenda = ev.elegida.agenda
        if (dry) {
          usadas.add(agenda.id)
          resumen.enganchadas++
          anotar(g, 'auto', agenda.id, ev.elegida.puntaje, ev.motivo)
          continue
        }
        const r = await enlazarGrabacion(supabase, g, agenda.id, { metodo: 'auto', puntaje: ev.elegida.puntaje, tabla })
        if (!r.ok) {
          // El índice único salta si dos grabaciones caen en la misma agenda.
          // No es motivo para cortar el resto: se cuenta y se sigue.
          console.error(`[fathom-sync] no se pudo enganchar ${g.recordingId} a la agenda ${agenda.id}: ${r.error}`)
          resumen.errores++
          anotar(g, 'error', agenda.id, ev.elegida.puntaje, r.error ?? 'error al asociar')
          continue
        }
        usadas.add(agenda.id)
        resumen.enganchadas++
        anotar(g, 'auto', agenda.id, ev.elegida.puntaje, ev.motivo)

        // El reporte llega escrito a medias: el borrador se arma en el acto, y
        // la tarea de aprobarlo la crea el barrido de triaje. Solo en llamadas
        // recientes (ver DIAS_BORRADOR).
        if (r.reciente && (await completarBorradorDeAgenda(supabase, agenda.id))) resumen.borradores++
        continue
      }

      let clientId = g.clientId
      let sugerida: string | null = null
      let puntaje: number | null = null
      let metodo: string | null = null

      if (ev.decision === 'sugerida' && ev.elegida) {
        resumen.ambiguas++
        clientId = ev.elegida.agenda.client_id
        sugerida = ev.elegida.agenda.id
        puntaje = ev.elegida.puntaje
        metodo = 'sugerida'
        anotar(g, 'sugerida', sugerida, puntaje, ev.motivo)
      } else {
        resumen.sinAgenda++
        const conExternos = invitadosExternos(g.invitados).length > 0
        if (!clientId && clienteUnico && conExternos) clientId = clienteUnico
        anotar(g, 'sin_agenda', null, ev.candidatas[0]?.puntaje ?? null, ev.motivo)
      }

      // Solo se escribe si algo cambió: el reintento repasa las mismas cada
      // media hora.
      const cambio =
        clientId !== g.clientId || sugerida !== g.sugeridaAgendaId || puntaje !== g.matchPuntaje || metodo !== g.matchMetodo
      if (tabla && !dry && cambio) {
        const { error } = await supabase
          .from('fathom_grabaciones')
          .update({ client_id: clientId, sugerida_agenda_id: sugerida, match_puntaje: puntaje, match_metodo: metodo })
          .eq('recording_id', g.recordingId)
        if (error) {
          resumen.errores++
          console.error(`[fathom-sync] no se guardó la sugerencia de ${g.recordingId}: ${error.message}`)
        }
      }
    }

    return { ok: true, resumen, detalle, siguienteCursor }
  } catch (e) {
    const error = e as { message?: string }
    resumen.error = error.message ?? String(e)
    return { ok: false, motivo: resumen.error, resumen, detalle, siguienteCursor }
  }
}
