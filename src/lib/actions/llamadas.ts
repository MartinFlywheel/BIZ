'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { hoyChile, isoChileDe, sumarDias } from '@/lib/fecha-chile'
import { ESTADOS_REPORTE } from '@/lib/pipeline-tipos'
import {
  COLUMNAS_GRABACION,
  desenlazarGrabacion,
  enlazarGrabacion,
  grabacionDesdeFila,
  type Grabacion,
} from '@/lib/services/fathom-sync'
import { invitadosExternos } from '@/lib/services/fathom'
import { completarBorradorDeAgenda } from '@/lib/services/reporte-llamada'
import { createAgendaRecord, updateAgendaRecord, type AgendaRecordFields } from './agenda-records'

/**
 * La pestaña Llamadas, sobre las agendas.
 *
 * Antes leía sales_calls, una tabla que nadie llena sola, y por eso no mostraba
 * ni una grabación de Fathom. Ahora la fuente de verdad es agenda_records: una
 * llamada es una agenda que ya ocurrió (fecha en hora de Chile) y no se
 * canceló. Se le suman las grabaciones de Fathom que todavía no tienen agenda,
 * para asociarlas a mano, y las filas de sales_calls de legado que no se
 * enlazaron a ninguna agenda.
 *
 * Sin la migración 074 no existe fathom_grabaciones ni
 * sales_calls.agenda_record_id: la pestaña muestra las agendas y todo el
 * legado, y avisa que falta la migración, en vez de romperse.
 */

const TABLA_INEXISTENTE = '42P01'
const COLUMNA_INEXISTENTE = '42703'
const FALTA_074 = 'Falta correr la migración 074-grabaciones-fathom-y-llamadas.sql.'

export type OrigenLlamada = 'agenda' | 'grabacion_suelta' | 'legado'
export type ResultadoLlamada = 'cerrada' | 'no_cerrada' | 'no_show' | 'pendiente' | 'otro'

export interface SugerenciaAgenda {
  agendaId: string
  nombre: string | null
  fecha: string | null
  puntaje: number | null
}

export interface Llamada {
  /** Clave estable para la lista: origen + id. */
  clave: string
  origen: OrigenLlamada
  clientId: string | null
  clienteNombre: string | null
  agendaId: string | null
  recordingId: string | null
  legadoId: string | null
  leadId: string | null
  nombre: string | null
  /** Timestamp ISO si hay hora; 'YYYY-MM-DD' si solo hay fecha. */
  cuando: string | null
  conHora: boolean
  closer: string | null
  setter: string | null
  estado: string | null
  resultado: ResultadoLlamada
  grabacionUrl: string | null
  resumen: string | null
  duracionMin: number | null
  reporteEstado: string | null
  grabadoPor: string | null
  sugerencia: SugerenciaAgenda | null
}

export interface DatosLlamadas {
  llamadas: Llamada[]
  /** La 074 no se corrió: faltan las grabaciones sin agenda. */
  migracionPendiente: boolean
  hoy: string
}

type Resultado = { ok: true; agendaId?: string | null } | { ok: false; error: string }

type Supa = Awaited<ReturnType<typeof createClient>>

async function exigirAgencia(): Promise<Supa> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay sesión')
  const { data: perfil } = await supabase.from('users').select('user_type').eq('id', user.id).single()
  if (perfil?.user_type !== 'agency') throw new Error('No autorizado')
  return supabase
}

function sinTildes(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** El resultado sale del estado que el equipo escribe en la agenda. */
function resultadoDeEstado(estado: string | null | undefined): ResultadoLlamada {
  const e = sinTildes(estado ?? '')
  if (e === 'cerrado' || e === 'cerrada') return 'cerrada'
  if (e === 'no cerrado' || e === 'no cerrada') return 'no_cerrada'
  if (e === 'no show') return 'no_show'
  // "Show" sin más dice que se conectó, pero no cómo terminó.
  if (e === '' || e === 'pendiente' || e === 'show') return 'pendiente'
  return 'otro'
}

/** Solo enlaces que se pueden abrir: fuera la URI de API que guardaba el webhook viejo de Calendly. */
function enlaceVisible(link: string | null | undefined): string | null {
  if (!link || !/^https?:\/\//i.test(link)) return null
  if (/api\.calendly\.com/i.test(link)) return null
  return link
}

function minutosEntre(inicio: string | null, fin: string | null): number | null {
  if (!inicio || !fin) return null
  const ms = new Date(fin).getTime() - new Date(inicio).getTime()
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : null
}

function uno<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null
}

function ordenDe(l: Llamada): number {
  if (!l.cuando) return 0
  return l.conHora ? new Date(l.cuando).getTime() : Date.parse(`${l.cuando}T16:00:00Z`)
}

interface FilaAgenda {
  id: string
  client_id: string
  lead_id: string | null
  nombre_lead: string | null
  fecha_agenda: string | null
  hora_agenda?: string | null
  closer: string | null
  setter: string | null
  estado: string | null
  link_reporte: string | null
  fathom_recording_id?: string | null
  fathom_resumen?: string | null
  reporte_estado?: string | null
  cancelada_at?: string | null
  leads: { full_name: string | null; ig_username: string | null } | { full_name: string | null; ig_username: string | null }[] | null
  clients: { name: string | null } | { name: string | null }[] | null
}

interface FilaLegado {
  id: string
  lead_id: string
  scheduled_at: string | null
  bucket: string | null
  outcome: string | null
  fathom_call_url: string | null
  ai_summary: string | null
  duration_seconds: number | null
  leads: {
    client_id: string
    full_name: string | null
    ig_username: string | null
    clients: { name: string | null } | { name: string | null }[] | null
  } | { client_id: string; full_name: string | null; ig_username: string | null; clients: unknown }[] | null
}

async function cargarLlamadas(
  supabase: Supa,
  filtro: { clientId?: string; desde?: string }
): Promise<DatosLlamadas> {
  const hoy = hoyChile().iso
  let migracionPendiente = false

  // ── Agendas ya ocurridas ──
  // select('*') a propósito: las columnas de 052, 055 y 070 pueden faltar en
  // algún entorno y un select explícito rompería la pestaña entera.
  const agendas = await fetchAllRows<FilaAgenda>((from, to) => {
    let q = supabase
      .from('agenda_records')
      .select('*, leads(full_name, ig_username), clients(name)')
      .lte('fecha_agenda', hoy)
      .order('fecha_agenda', { ascending: false })
      .range(from, to)
    if (filtro.clientId) q = q.eq('client_id', filtro.clientId)
    if (filtro.desde) q = q.gte('fecha_agenda', filtro.desde)
    return q
  })
  const vivas = agendas.filter((a) => !a.cancelada_at)

  // ── Grabaciones de Fathom ──
  let grabaciones: Grabacion[] = []
  {
    const filas = await fetchAllRows<Record<string, unknown>>((from, to) => {
      let q = supabase.from('fathom_grabaciones').select(COLUMNAS_GRABACION).range(from, to)
      if (filtro.clientId) q = q.eq('client_id', filtro.clientId)
      if (filtro.desde) q = q.gte('recording_start_time', `${sumarDias(filtro.desde, -1)}T00:00:00Z`)
      return q
    }).catch((e: { code?: string }) => {
      if (e?.code === TABLA_INEXISTENTE) {
        migracionPendiente = true
        return [] as Record<string, unknown>[]
      }
      throw e
    })
    grabaciones = filas.map(grabacionDesdeFila)
  }

  // ── Legado de sales_calls sin agenda ──
  const columnasLegado =
    'id, lead_id, scheduled_at, bucket, outcome, fathom_call_url, ai_summary, duration_seconds, leads!inner(client_id, full_name, ig_username, clients(name))'
  const pedirLegado = (conEnlace: boolean) =>
    fetchAllRows<FilaLegado>((from, to) => {
      let q = supabase.from('sales_calls').select(columnasLegado).range(from, to)
      if (conEnlace) q = q.is('agenda_record_id', null)
      if (filtro.clientId) q = q.eq('leads.client_id', filtro.clientId)
      if (filtro.desde) q = q.gte('scheduled_at', `${filtro.desde}T00:00:00Z`)
      return q
    })
  const legado = await pedirLegado(true).catch((e: { code?: string }) => {
    if (e?.code !== COLUMNA_INEXISTENTE) throw e
    migracionPendiente = true
    return pedirLegado(false)
  })

  const grabPorAgenda = new Map<string, Grabacion>()
  const grabPorId = new Map<string, Grabacion>()
  for (const g of grabaciones) {
    grabPorId.set(g.recordingId, g)
    if (g.agendaId) grabPorAgenda.set(g.agendaId, g)
  }
  const agendaPorId = new Map(vivas.map((a) => [a.id, a]))

  const llamadas: Llamada[] = []
  const grabacionesUsadas = new Set<string>()

  for (const a of vivas) {
    const g = grabPorAgenda.get(a.id) ?? (a.fathom_recording_id ? grabPorId.get(String(a.fathom_recording_id)) : undefined)
    if (g) grabacionesUsadas.add(g.recordingId)
    const lead = uno(a.leads)
    llamadas.push({
      clave: `agenda:${a.id}`,
      origen: 'agenda',
      clientId: a.client_id,
      clienteNombre: uno(a.clients)?.name ?? null,
      agendaId: a.id,
      recordingId: g?.recordingId ?? (a.fathom_recording_id ? String(a.fathom_recording_id) : null),
      legadoId: null,
      leadId: a.lead_id,
      nombre: a.nombre_lead || lead?.full_name || lead?.ig_username || null,
      cuando: a.hora_agenda ?? a.fecha_agenda,
      conHora: !!a.hora_agenda,
      closer: a.closer,
      setter: a.setter,
      estado: a.estado,
      resultado: resultadoDeEstado(a.estado),
      grabacionUrl: enlaceVisible(g?.shareUrl ?? g?.url) ?? enlaceVisible(a.link_reporte),
      // En llamadas viejas el resumen vive solo en la tabla (ver enlazarGrabacion).
      resumen: a.fathom_resumen ?? g?.resumen ?? null,
      duracionMin: g ? minutosEntre(g.inicio, g.fin) : null,
      reporteEstado: a.reporte_estado ?? null,
      grabadoPor: g?.grabadoPorNombre ?? null,
      sugerencia: null,
    })
  }

  // Sugerencias que apuntan a agendas fuera de la lista (por ejemplo, con
  // fecha de mañana): se piden aparte para poder mostrar el nombre.
  const sueltas = grabaciones.filter((g) => !g.agendaId && !grabacionesUsadas.has(g.recordingId))
  const faltantes = [...new Set(sueltas.map((g) => g.sugeridaAgendaId).filter((id): id is string => !!id && !agendaPorId.has(id)))]
  const extra = new Map<string, { nombre_lead: string | null; fecha_agenda: string | null }>()
  if (faltantes.length > 0) {
    const { data } = await supabase.from('agenda_records').select('id, nombre_lead, fecha_agenda').in('id', faltantes)
    for (const f of data ?? []) extra.set(f.id as string, { nombre_lead: f.nombre_lead as string | null, fecha_agenda: f.fecha_agenda as string | null })
  }

  for (const g of sueltas) {
    const externo = invitadosExternos(g.invitados).find((i) => i.name || i.email)
    const sugerida = g.sugeridaAgendaId ? agendaPorId.get(g.sugeridaAgendaId) ?? extra.get(g.sugeridaAgendaId) : undefined
    llamadas.push({
      clave: `grabacion:${g.recordingId}`,
      origen: 'grabacion_suelta',
      clientId: g.clientId,
      clienteNombre: null,
      agendaId: null,
      recordingId: g.recordingId,
      legadoId: null,
      leadId: null,
      nombre: externo?.name || externo?.email || g.titulo,
      cuando: g.programada ?? g.inicio,
      conHora: !!(g.programada ?? g.inicio),
      closer: null,
      setter: null,
      estado: null,
      resultado: 'pendiente',
      grabacionUrl: enlaceVisible(g.shareUrl ?? g.url),
      resumen: g.resumen,
      duracionMin: minutosEntre(g.inicio, g.fin),
      reporteEstado: null,
      grabadoPor: g.grabadoPorNombre,
      sugerencia: g.sugeridaAgendaId && sugerida
        ? { agendaId: g.sugeridaAgendaId, nombre: sugerida.nombre_lead, fecha: sugerida.fecha_agenda, puntaje: g.matchPuntaje }
        : null,
    })
  }

  for (const s of legado) {
    const lead = uno(s.leads) as { client_id: string; full_name: string | null; ig_username: string | null; clients: unknown } | null
    const resultado: ResultadoLlamada =
      s.outcome === 'no_show' ? 'no_show' : s.bucket === 'cerrada' ? 'cerrada' : s.bucket === 'no_cerrada' ? 'no_cerrada' : 'pendiente'
    llamadas.push({
      clave: `legado:${s.id}`,
      origen: 'legado',
      clientId: lead?.client_id ?? null,
      clienteNombre: (uno(lead?.clients as { name: string | null } | null) as { name: string | null } | null)?.name ?? null,
      agendaId: null,
      recordingId: null,
      legadoId: s.id,
      leadId: s.lead_id,
      nombre: lead?.full_name || lead?.ig_username || null,
      // La hora de estas filas es un marcador (12:00 UTC puesto por el
      // formulario viejo): se muestra solo el día.
      cuando: s.scheduled_at ? isoChileDe(s.scheduled_at) : null,
      conHora: false,
      closer: null,
      setter: null,
      estado: null,
      resultado,
      grabacionUrl: enlaceVisible(s.fathom_call_url),
      resumen: s.ai_summary,
      duracionMin: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
      reporteEstado: null,
      grabadoPor: null,
      sugerencia: null,
    })
  }

  llamadas.sort((x, y) => ordenDe(y) - ordenDe(x))
  return { llamadas, migracionPendiente, hoy }
}

/** Todo lo que necesita la pestaña Llamadas del cliente, en una llamada. */
export async function getLlamadasCliente(clientId: string): Promise<DatosLlamadas> {
  const supabase = await createClient()
  return cargarLlamadas(supabase, { clientId })
}

/**
 * La página global /calls: la misma fuente, de todos los clientes, acotada a
 * los últimos días para no bajar el historial completo en cada visita.
 */
export async function getLlamadasGlobal(dias = 60): Promise<DatosLlamadas> {
  const supabase = await exigirAgencia()
  const desde = sumarDias(hoyChile().iso, -Math.min(Math.max(dias, 1), 365))
  return cargarLlamadas(supabase, { desde })
}

function revalidar(clientId: string | null | undefined) {
  if (clientId) revalidatePath(`/clients/${clientId}`)
  revalidatePath('/calls')
}

export async function asociarGrabacion(recordingId: string, agendaId: string): Promise<Resultado> {
  try {
    const supabase = await exigirAgencia()
    const { data: fila, error } = await supabase
      .from('fathom_grabaciones')
      .select(COLUMNAS_GRABACION)
      .eq('recording_id', recordingId)
      .maybeSingle()

    if (error?.code === TABLA_INEXISTENTE) return { ok: false, error: FALTA_074 }
    if (error) return { ok: false, error: error.message }
    if (!fila) return { ok: false, error: 'No se encontró la grabación.' }

    const g = grabacionDesdeFila(fila as Record<string, unknown>)
    if (g.agendaId === agendaId) return { ok: true, agendaId }
    if (g.agendaId) return { ok: false, error: 'La grabación ya está asociada a otra agenda. Desasóciala primero.' }

    const r = await enlazarGrabacion(supabase, g, agendaId, { metodo: 'manual', puntaje: null, tabla: true })
    if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo asociar la grabación.' }

    // Mismo criterio que el sync: borrador solo para llamadas recientes. Si
    // falla, lo reintenta el barrido de triaje; la asociación ya quedó.
    if (r.reciente) {
      try {
        await completarBorradorDeAgenda(createAdminClient(), agendaId)
      } catch (e) {
        console.error(`[llamadas] no se armó el borrador de ${agendaId}:`, e)
      }
    }

    revalidar(r.clientId)
    return { ok: true, agendaId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo asociar la grabación.' }
  }
}

export async function desasociarGrabacion(recordingId: string): Promise<Resultado> {
  try {
    const supabase = await exigirAgencia()
    const r = await desenlazarGrabacion(supabase, recordingId)
    if (!r.ok) return { ok: false, error: r.error ?? 'No se pudo desasociar la grabación.' }
    revalidar(r.clientId)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo desasociar la grabación.' }
  }
}

const ESTADOS_VALIDOS: string[] = ['Pendiente', ...ESTADOS_REPORTE]

/**
 * Cambia el resultado de una llamada. Pasa por updateAgendaRecord para que
 * cualquier efecto que dispare el estado de la agenda se aplique igual que
 * desde la planilla.
 */
export async function cambiarEstadoLlamada(agendaId: string, estado: string): Promise<Resultado> {
  try {
    const supabase = await exigirAgencia()
    if (!ESTADOS_VALIDOS.includes(estado)) return { ok: false, error: 'Estado no válido.' }
    const { data: agenda } = await supabase.from('agenda_records').select('client_id').eq('id', agendaId).maybeSingle()
    if (!agenda) return { ok: false, error: 'No se encontró la agenda.' }
    await updateAgendaRecord(agendaId, { estado })
    revalidar(agenda.client_id as string)
    return { ok: true, agendaId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo cambiar el estado.' }
  }
}

export interface AgendaDeLead {
  id: string
  fecha_agenda: string | null
  hora_agenda: string | null
  estado: string | null
  closer: string | null
  tieneGrabacion: boolean
  delCalendario: boolean
}

/** Las agendas de un lead, para que "Registrar llamada" edite una en vez de duplicarla. */
export async function getAgendasDeLead(clientId: string, leadId: string): Promise<AgendaDeLead[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agenda_records')
    .select('*')
    .eq('client_id', clientId)
    .eq('lead_id', leadId)
    .order('fecha_agenda', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? [])
    .filter((a) => !a.cancelada_at)
    .map((a) => ({
      id: a.id as string,
      fecha_agenda: (a.fecha_agenda as string | null) ?? null,
      hora_agenda: (a.hora_agenda as string | null) ?? null,
      estado: (a.estado as string | null) ?? null,
      closer: (a.closer as string | null) ?? null,
      tieneGrabacion: !!a.fathom_recording_id,
      delCalendario: !!a.google_event_id,
    }))
}

/** "YYYY-MM-DD" + "HH:MM" en hora de Chile → instante ISO en UTC. */
function instanteChile(fecha: string, hora: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hora)
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m || !f) return null
  const deseado = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(m[1]), Number(m[2]))
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  let utc = deseado
  // Dos pasadas bastan para asentar el desfase, incluso el día del cambio de hora.
  for (let i = 0; i < 2; i++) {
    const partes = formato.formatToParts(new Date(utc))
    const valor = (t: string) => Number(partes.find((p) => p.type === t)?.value)
    const local = Date.UTC(valor('year'), valor('month') - 1, valor('day'), valor('hour'), valor('minute'))
    utc += deseado - local
  }
  return new Date(utc).toISOString()
}

export interface DatosRegistro {
  clientId: string
  /** Agenda que se edita. Sin ella se busca una del lead ese día o se crea. */
  agendaId?: string | null
  leadId?: string | null
  nombre?: string | null
  fecha: string
  hora?: string | null
  closer?: string | null
  estado: string
  linkGrabacion?: string | null
}

/**
 * "Registrar llamada" ya no inserta en sales_calls: edita la agenda de esa
 * llamada, o la crea si no existe. Así el closer y el estado quedan en la misma
 * fila que recibe la grabación de Fathom y alimenta el reporte.
 */
export async function registrarLlamada(datos: DatosRegistro): Promise<Resultado> {
  try {
    const supabase = await exigirAgencia()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) return { ok: false, error: 'Elige la fecha de la llamada.' }
    if (!ESTADOS_VALIDOS.includes(datos.estado)) return { ok: false, error: 'Elige el resultado de la llamada.' }

    const link = datos.linkGrabacion?.trim() || null
    if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: 'El enlace de la grabación debe empezar con https://' }
    const closer = datos.closer?.trim() || null
    const hora = datos.hora ? instanteChile(datos.fecha, datos.hora) : null

    let agendaId = datos.agendaId ?? null

    // Con lead y sin agenda elegida: la del lead ese mismo día, si hay una sola.
    if (!agendaId && datos.leadId) {
      const { data } = await supabase
        .from('agenda_records')
        .select('*')
        .eq('client_id', datos.clientId)
        .eq('lead_id', datos.leadId)
        .eq('fecha_agenda', datos.fecha)
      const vivas = (data ?? []).filter((a) => !a.cancelada_at)
      if (vivas.length === 1) agendaId = vivas[0].id as string
    }

    if (agendaId) {
      const { data: agenda } = await supabase.from('agenda_records').select('*').eq('id', agendaId).maybeSingle()
      if (!agenda || agenda.client_id !== datos.clientId) return { ok: false, error: 'No se encontró la agenda.' }

      const cambios: AgendaRecordFields = { estado: datos.estado }
      if (closer) cambios.closer = closer
      if (datos.leadId && !agenda.lead_id) cambios.lead_id = datos.leadId
      // Lo que vino del calendario manda: una agenda sincronizada no cambia de
      // fecha ni de hora desde aquí.
      if (!agenda.google_event_id) {
        cambios.fecha_agenda = datos.fecha
        if (hora) cambios.hora_agenda = hora
      }
      if (link && !agenda.link_reporte) cambios.link_reporte = link

      await updateAgendaRecord(agendaId, cambios)
      revalidar(datos.clientId)
      return { ok: true, agendaId }
    }

    let nombre = datos.nombre?.trim() || null
    if (!nombre && datos.leadId) {
      const { data: lead } = await supabase.from('leads').select('full_name, ig_username').eq('id', datos.leadId).maybeSingle()
      nombre = (lead?.full_name as string | null) || (lead?.ig_username as string | null) || null
    }
    if (!datos.leadId && !nombre) return { ok: false, error: 'Busca el lead o escribe el nombre de la persona.' }

    const creada = await createAgendaRecord(datos.clientId, {
      lead_id: datos.leadId ?? null,
      nombre_lead: nombre,
      fecha_agenda: datos.fecha,
      fecha_agendado: hoyChile().iso,
      ...(hora ? { hora_agenda: hora } : {}),
      closer,
      estado: datos.estado,
      link_reporte: link,
    })

    revalidar(datos.clientId)
    return { ok: true, agendaId: creada.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo registrar la llamada.' }
  }
}
