'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LEAD_STAGES, type PipelineStageConfig } from '@/lib/types'
import { CALIFICA_OPCIONES, PRIORIDAD_OPCIONES, TEMPERATURA_OPCIONES, etiquetaDe, type FichaTriaje } from '@/lib/pipeline-tipos'
import { assertCanViewLead } from './lead-access'

/**
 * La línea de tiempo de un lead: todo lo que hizo y todo lo que le pasó.
 *
 * No existe una tabla con esa historia. Está repartida en una docena de tablas
 * que se unen por claves distintas (lead_id, client_id + ig_username,
 * agenda_record_id, el payload de ManyChat), así que aquí se consultan todas en
 * paralelo y se arma una sola lista ordenada.
 *
 * Reglas que sostienen esto:
 * - El acceso se valida antes de leer nada (assertCanViewLead): un setter no
 *   ve el lead calificado de otro, quien no es admin solo ve su cliente y el
 *   portal de clientes nunca.
 * - Ninguna fuente puede tumbar la línea de tiempo. Si una tabla o columna
 *   todavía no existe (migración sin correr: 42P01, 42703, PGRST205) se anota
 *   en fuentesNoDisponibles; cualquier otro error va a console.error y se
 *   sigue con las demás.
 * - webhook_logs se lee con el cliente admin DESPUÉS de validar el acceso, y
 *   al navegador solo llegan campos elegidos (último mensaje y enlace al chat),
 *   nunca el payload crudo: trae teléfono, correo y datos de ManyChat.
 * - Es solo lectura: no hay revalidatePath.
 */

export type TipoEventoLead =
  | 'ingreso' | 'cta' | 'respuesta' | 'calificado' | 'manychat'
  | 'etapa' | 'asignacion' | 'etiquetas' | 'seguimiento' | 'eliminado'
  | 'agenda' | 'reagendada' | 'cancelada' | 'triaje' | 'llamada' | 'grabacion' | 'reporte'
  | 'tarea' | 'cierre' | 'alumno'

export type FuenteEventoLead =
  | 'lead' | 'interacciones' | 'manychat' | 'historial_crm' | 'registro'
  | 'agenda' | 'tareas' | 'llamadas' | 'fathom' | 'programa'

export interface EventoLead {
  id: string
  /** ISO 8601. */
  at: string
  tipo: TipoEventoLead
  titulo: string
  detalle: string | null
  actor: string | null
  fuente: FuenteEventoLead
  enlace: { url: string; texto: string } | null
  /** Advertencia que conviene ver junto al evento (p. ej. cruce por nombre). */
  aviso: string | null
}

export interface AgendaResumen {
  id: string
  horaAgenda: string | null
  fechaAgenda: string | null
  estado: string | null
  matchMetodo: string | null
  respuestas: Record<string, string>
  fathomResumen: string | null
  linkReporte: string | null
  cancelada: boolean
}

export interface LeadResumen {
  id: string
  clientId: string
  clientName: string | null
  fullName: string | null
  igUsername: string | null
  email: string | null
  phone: string | null
  stage: string | null
  stageLabel: string | null
  setterName: string | null
  createdAt: string | null
  origen: string | null
  lostReason: string | null
  /** prequalification_data de ManyChat (nivel, zona, edad...). */
  calificacion: Record<string, unknown> | null
  /** Las agendas del lead, la más reciente primero. */
  agendas: AgendaResumen[]
}

export interface LineaDeTiempoLead {
  lead: LeadResumen
  eventos: EventoLead[]
  fuentesNoDisponibles: string[]
}

// ── Utilidades ──────────────────────────────────────────────────────────────

type ErrorPg = { code?: string; message?: string } | null | undefined

/** Tabla o columna que todavía no existe: migración sin correr. */
function esEsquemaFaltante(error: ErrorPg): boolean {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205' || error?.code === 'PGRST204'
}

type Fila = Record<string, unknown>

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Un instante válido en ISO, o null. Una fecha rota no debe llegar a la UI. */
function instante(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Solo enlaces http(s): un live_chat_url raro no puede terminar en un javascript:. */
function enlaceSeguro(url: unknown, textoEnlace: string): { url: string; texto: string } | null {
  const s = texto(url)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? { url: u.toString(), texto: textoEnlace } : null
  } catch {
    return null
  }
}

// Hora de Chile: el equipo trabaja desde ahí, y la misma llamada no puede
// figurar a horas distintas según el servidor o el navegador.
function fechaHoraCl(iso: string | null): string {
  if (!iso) return 'sin hora'
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function monto(v: unknown): string | null {
  const n = numero(v)
  if (n === null || n === 0) return null
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
}

function recortar(s: string | null, max: number): string | null {
  if (!s) return null
  const limpio = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio
}

function unir(partes: (string | null | undefined | false)[], sep = ' · '): string | null {
  const r = partes.filter((p): p is string => typeof p === 'string' && p.length > 0).join(sep)
  return r || null
}

/** Escapa los comodines de ILIKE para comparar el usuario de IG literal. */
function literalLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function prettify(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Mismos nombres que la pestaña CRM (etiquetaFuente en crm-tab.tsx).
const FUENTE_LABEL: Record<string, string> = {
  manychat_keyword: 'Instagram', manychat_direct: 'Instagram', instagram: 'Instagram',
  whatsapp: 'WhatsApp', youtube: 'YouTube', formulario: 'Formulario', manual: 'Manual',
  keyword_dm: 'DM por palabra clave', lead_magnet: 'Lead magnet', lead_magnet_incompleto: 'Lead magnet (incompleto)',
}

function etiquetaOrigen(tipo: string | null): string | null {
  if (!tipo) return null
  if (tipo.startsWith('manychat:')) return `ManyChat, CTA ${tipo.slice('manychat:'.length)}`
  if (tipo.startsWith('agent:')) {
    const canal = tipo.slice('agent:'.length)
    return `Agente (${FUENTE_LABEL[canal] ?? canal})`
  }
  return FUENTE_LABEL[tipo] ?? tipo
}

const NOMBRE_TAREA: Record<string, string> = {
  triaje_agenda: 'triaje de la agenda',
  asociar_lead: 'asociar el lead a la agenda',
  reporte_llamada: 'reporte de la llamada',
}

const RESULTADO_LLAMADA: Record<string, string> = {
  completed: 'realizada', no_show: 'no se presentó', rescheduled: 'reagendada', cancelled: 'cancelada',
}

/** Actor legible: el nombre si hay usuario; si no, de dónde vino el cambio. */
function actorDe(usuarios: Map<string, string>, actorId: unknown, origen?: unknown): string | null {
  const id = texto(actorId)
  if (id && usuarios.has(id)) return usuarios.get(id)!
  const o = texto(origen)
  if (!o || o === 'crm') return null
  if (o === 'sistema') return 'Automático'
  if (o === 'sql') return 'Cambio directo en la base'
  return `Automático (${o})`
}

// ── La server action ────────────────────────────────────────────────────────

export async function getLeadTimeline(leadId: string): Promise<LineaDeTiempoLead> {
  const { supabase, lead: acceso } = await assertCanViewLead(leadId)
  const clientId = acceso.client_id as string
  const igAcceso = texto(acceso.ig_username)?.replace(/^@/, '') ?? null

  const faltantes = new Set<string>()
  const eventos: EventoLead[] = []

  /**
   * Corre una consulta de una fuente. Nunca lanza: si falta el esquema lo
   * anota, si falla por otra cosa lo deja en los logs, y en ambos casos
   * devuelve null para que la línea de tiempo siga con lo demás.
   */
  async function leer<T>(
    fuente: string,
    consulta: () => PromiseLike<{ data: T | null; error: ErrorPg }>,
    opciones: { silenciarFaltante?: boolean } = {}
  ): Promise<T | null> {
    try {
      const { data, error } = await consulta()
      if (error) {
        if (esEsquemaFaltante(error)) {
          if (!opciones.silenciarFaltante) faltantes.add(fuente)
        } else {
          console.error(`[getLeadTimeline] ${fuente} falló para ${leadId}:`, error.code, error.message)
        }
        return null
      }
      return data
    } catch (e) {
      console.error(`[getLeadTimeline] ${fuente} lanzó para ${leadId}:`, e instanceof Error ? e.message : e)
      return null
    }
  }

  // ── Fase 1: todo lo que se cruza por el lead o por el cliente ─────────────
  // Las piezas se piden una vez: dan el nombre del CTA a las interacciones y
  // filtran las llamadas de ManyChat que son de este cliente.
  const piezasDelCliente = leer<Fila[]>('Piezas de contenido', () => supabase
    .from('content_pieces')
    .select('id, keyword_trigger')
    .eq('client_id', clientId))

  const [
    rLead, rCliente, rUsuarios, rPiezas, rInteracciones, rActividad, rEventos,
    rAgendas, rLlamadas, rAlumnos, rManychat,
  ] = await Promise.allSettled([
    leer<Fila>('Lead', () => supabase.from('leads').select('*').eq('id', leadId).single()),
    leer<Fila>('Cliente', () => supabase.from('clients').select('id, name, pipeline_stages').eq('id', clientId).single()),
    leer<Fila[]>('Usuarios', () => supabase.from('users').select('id, full_name')),
    piezasDelCliente,
    igAcceso
      ? leer<Fila[]>('Interacciones de ManyChat', () => supabase
          .from('interactions')
          .select('id, content_id, keyword_used, classification, bot_triggered_at, prospect_responded_at, qualified_at, prequalification_data, created_at')
          .eq('client_id', clientId)
          .ilike('ig_username', literalLike(igAcceso))
          .order('bot_triggered_at', { ascending: true })
          .limit(200))
      : Promise.resolve([] as Fila[]),
    leer<Fila[]>('Historial de etapas del CRM', () => supabase
      .from('lead_activity_logs')
      .select('id, action_type, stage_at_time, created_at, user_id')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(500)),
    leer<Fila[]>('Registro de cambios (migración 075)', () => supabase
      .from('lead_events')
      .select('id, tipo, desde, hasta, actor_id, origen, datos, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(1000)),
    leer<Fila[]>('Agendas', () => supabase
      .from('agenda_records')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })),
    leer<Fila[]>('Llamadas de ventas', () => supabase
      .from('sales_calls')
      .select('id, scheduled_at, started_at, duration_seconds, outcome, fathom_call_url, ai_summary, next_steps, caller_id, created_at')
      .eq('lead_id', leadId)),
    leer<Fila[]>('Alumnos del programa', () => supabase
      .from('program_students')
      .select('id, start_date, created_at')
      .eq('lead_id', leadId)),
    leerManychat({ leadId, igUsername: igAcceso, piezasDelCliente, faltantes }),
  ])

  function valor<T>(r: PromiseSettledResult<T | null>): T | null {
    return r.status === 'fulfilled' ? r.value : null
  }

  const leadRow = valor(rLead) ?? (acceso as unknown as Fila)
  const cliente = valor(rCliente)
  const usuarios = new Map<string, string>()
  for (const u of valor(rUsuarios) ?? []) {
    const id = texto(u.id)
    const nombre = texto(u.full_name)
    if (id && nombre) usuarios.set(id, nombre)
  }

  const piezas = valor(rPiezas) ?? []
  const keywordPorPieza = new Map<string, string>()
  for (const p of piezas) {
    const kw = texto(p.keyword_trigger)
    if (kw) keywordPorPieza.set(String(p.id), kw)
  }

  const etapas: PipelineStageConfig[] = Array.isArray(cliente?.pipeline_stages) && (cliente!.pipeline_stages as unknown[]).length > 0
    ? (cliente!.pipeline_stages as PipelineStageConfig[])
    : LEAD_STAGES
  const etiquetaEtapa = (id: unknown): string => {
    const s = texto(id)
    if (!s) return 'sin etapa'
    return etapas.find((e) => e.id === s)?.label ?? LEAD_STAGES.find((e) => e.id === s)?.label ?? prettify(s)
  }

  const agendas = valor(rAgendas) ?? []
  const agendaPorId = new Map(agendas.map((a) => [String(a.id), a]))
  const agendaIds = [...agendaPorId.keys()]
  const registro = valor(rEventos)
  const registroDisponible = rEventos.status === 'fulfilled' && registro !== null

  // ── Fase 2: lo que cuelga de las agendas ─────────────────────────────────
  const [rTareas, rGrabaciones, rEventosDeAgenda] = await Promise.allSettled([
    agendaIds.length > 0
      ? leer<Fila[]>('Tareas del pipeline', () => supabase
          .from('system_tasks')
          .select('id, tipo, estado, agenda_record_id, created_at, completada_at, completada_por, escalada_at, pospuesta_veces')
          .in('agenda_record_id', agendaIds))
      : Promise.resolve([] as Fila[]),
    // La tabla la crea otro frente de trabajo: si aún no existe se omite sin
    // avisar, porque la grabación principal ya viene en agenda_records.
    agendaIds.length > 0
      ? leer<Fila[]>('Grabaciones de Fathom', () => supabase
          .from('fathom_grabaciones')
          .select('*')
          .in('agenda_record_id', agendaIds)
          .limit(50), { silenciarFaltante: true })
      : Promise.resolve([] as Fila[]),
    // Eventos de una agenda anteriores a que se asociara a este lead.
    agendaIds.length > 0 && registroDisponible
      ? leer<Fila[]>('Registro de cambios (migración 075)', () => supabase
          .from('lead_events')
          .select('id, tipo, desde, hasta, actor_id, origen, datos, created_at')
          .is('lead_id', null)
          .in('datos->>agenda_id', agendaIds)
          .limit(500))
      : Promise.resolve([] as Fila[]),
  ])

  // ── Lead ─────────────────────────────────────────────────────────────────
  const eventosRegistro = [...(registro ?? []), ...(valor(rEventosDeAgenda) ?? [])]
  const creado = eventosRegistro.find((e) => e.tipo === 'creado')
  const origenLead = etiquetaOrigen(texto(leadRow.first_touch_type))
  const referral = (leadRow.referral ?? null) as { headline?: string; source_id?: string } | null
  const anuncio = texto(referral?.headline) ?? texto(referral?.source_id)
  const quiz = leadRow.quiz && typeof leadRow.quiz === 'object' ? Object.keys(leadRow.quiz as object).length : 0

  const creadoAt = instante(leadRow.created_at)
  if (creadoAt) {
    eventos.push({
      id: `lead-ingreso-${leadId}`,
      at: creadoAt,
      tipo: 'ingreso',
      titulo: 'Entró al CRM',
      detalle: unir([
        origenLead ? `Origen: ${origenLead}` : null,
        anuncio ? `Anuncio: ${anuncio}` : null,
        quiz > 0 ? 'Respondió el quiz de la landing' : null,
      ]),
      actor: creado ? actorDe(usuarios, creado.actor_id, creado.origen) : null,
      fuente: 'lead',
      enlace: null,
      aviso: null,
    })
  }

  // Los cambios de etapa a "agendado" y a "cierre" ya salen del historial; las
  // fechas del lead solo se muestran si nada más las cubre.
  const cambiosDeEtapa: { at: number; etapa: string }[] = []

  // ── Registro de cambios (lead_events) ────────────────────────────────────
  for (const e of eventosRegistro) {
    const at = instante(e.created_at)
    if (!at) continue
    const datos = (e.datos ?? {}) as Record<string, unknown>
    const agendaId = texto(datos.agenda_id)
    const agendaViva = agendaId ? agendaPorId.get(agendaId) : undefined
    const actor = actorDe(usuarios, e.actor_id, e.origen)
    const base = { id: `evento-${e.id}`, at, actor, fuente: 'registro' as const, enlace: null, aviso: null }

    switch (e.tipo) {
      case 'creado':
        break // ya está en "Entró al CRM"
      case 'etapa':
        cambiosDeEtapa.push({ at: new Date(at).getTime(), etapa: String(e.hasta ?? '') })
        eventos.push({ ...base, tipo: 'etapa', titulo: `Etapa: ${etiquetaEtapa(e.desde)} → ${etiquetaEtapa(e.hasta)}`, detalle: null })
        break
      case 'asignacion': {
        const nuevo = texto(e.hasta)
        const anterior = texto(e.desde)
        eventos.push({
          ...base,
          tipo: 'asignacion',
          titulo: nuevo ? `Asignado a ${usuarios.get(nuevo) ?? 'un usuario eliminado'}` : 'Quedó sin setter',
          detalle: anterior ? `Antes: ${usuarios.get(anterior) ?? 'un usuario eliminado'}` : null,
        })
        break
      }
      case 'etiquetas': {
        const agregadas = Array.isArray(datos.agregadas) ? (datos.agregadas as string[]) : []
        const quitadas = Array.isArray(datos.quitadas) ? (datos.quitadas as string[]) : []
        eventos.push({
          ...base,
          tipo: 'etiquetas',
          titulo: 'Cambiaron las etiquetas',
          detalle: unir([
            agregadas.length ? `Agregó: ${agregadas.join(', ')}` : null,
            quitadas.length ? `Quitó: ${quitadas.join(', ')}` : null,
          ]),
        })
        break
      }
      case 'eliminado':
        eventos.push({ ...base, tipo: 'eliminado', titulo: 'Lead eliminado', detalle: `Estaba en ${etiquetaEtapa(e.desde)}` })
        break
      case 'agenda_creada':
        // Si la agenda sigue existiendo, su creación sale de agenda_records
        // con más detalle; aquí solo se muestran las que ya se borraron.
        if (!agendaViva) {
          eventos.push({ ...base, tipo: 'agenda', titulo: 'Agendó una llamada (la agenda ya no existe)', detalle: texto(datos.hora_agenda) ? `Para ${fechaHoraCl(instante(datos.hora_agenda))}` : null })
        }
        break
      case 'agenda_reagendada': {
        const antes = instante(e.desde)
        const despues = instante(e.hasta)
        eventos.push({
          ...base,
          tipo: 'reagendada',
          titulo: antes ? 'Llamada reagendada' : 'Se fijó la hora de la llamada',
          detalle: antes ? `De ${fechaHoraCl(antes)} a ${fechaHoraCl(despues)}` : `Para ${fechaHoraCl(despues)}`,
        })
        break
      }
      case 'agenda_estado':
        eventos.push({
          ...base,
          tipo: 'llamada',
          titulo: `Resultado de la agenda: ${texto(e.hasta) ?? 'sin estado'}`,
          detalle: texto(e.desde) ? `Antes: ${e.desde}` : null,
        })
        break
      case 'agenda_cancelada':
        if (!agendaViva?.cancelada_at) {
          eventos.push({ ...base, tipo: 'cancelada', titulo: 'Canceló la llamada', detalle: null })
        }
        break
      case 'agenda_reactivada':
        eventos.push({ ...base, tipo: 'agenda', titulo: 'La agenda cancelada volvió a quedar activa', detalle: null })
        break
      case 'agenda_asociada':
        eventos.push({
          ...base,
          tipo: 'agenda',
          titulo: 'Se asoció una agenda a este lead',
          detalle: null,
          aviso: datos.match_metodo === 'nombre' ? 'Asociado por nombre: revisa que sea la misma persona' : null,
        })
        break
      case 'agenda_desasociada':
        eventos.push({ ...base, tipo: 'agenda', titulo: 'Se quitó una agenda de este lead', detalle: null })
        break
      case 'agenda_eliminada':
        eventos.push({
          ...base,
          tipo: 'agenda',
          titulo: 'Se eliminó una agenda',
          detalle: unir([
            texto(datos.hora_agenda) ? `Era para ${fechaHoraCl(instante(datos.hora_agenda))}` : null,
            texto(datos.estado) ? `Estado: ${datos.estado}` : null,
            texto(datos.closer) ? `Closer: ${datos.closer}` : null,
            monto(datos.monto_upfront) ? `Upfront: ${monto(datos.monto_upfront)}` : null,
          ]),
        })
        break
    }
  }

  // ── Historial del CRM (lead_activity_logs) ───────────────────────────────
  // 'contacto' es un cambio de etapa hecho a mano en el CRM. Desde que existe
  // lead_events el trigger ya registra ese mismo cambio (y los que no pasan por
  // el CRM), así que solo se usa lo anterior al primer evento para no
  // duplicarlo. 'seguimiento' no tiene equivalente y va siempre.
  const primerEventoAt = registroDisponible && registro!.length > 0
    ? Math.min(...registro!.map((e) => new Date(String(e.created_at)).getTime()).filter(Number.isFinite))
    : Number.POSITIVE_INFINITY
  for (const log of valor(rActividad) ?? []) {
    const at = instante(log.created_at)
    if (!at) continue
    const t = new Date(at).getTime()
    const actor = actorDe(usuarios, log.user_id)
    if (log.action_type === 'seguimiento') {
      eventos.push({
        id: `actividad-${log.id}`, at, tipo: 'seguimiento', titulo: 'Seguimiento registrado',
        detalle: `En ${etiquetaEtapa(log.stage_at_time)}`, actor, fuente: 'historial_crm', enlace: null, aviso: null,
      })
    } else if (t < primerEventoAt) {
      cambiosDeEtapa.push({ at: t, etapa: String(log.stage_at_time ?? '') })
      eventos.push({
        id: `actividad-${log.id}`, at, tipo: 'etapa', titulo: `Movido a ${etiquetaEtapa(log.stage_at_time)}`,
        detalle: null, actor, fuente: 'historial_crm', enlace: null, aviso: null,
      })
    }
  }

  const cubierto = (iso: string, etapasBuscadas: string[]) => {
    const t = new Date(iso).getTime()
    return cambiosDeEtapa.some((c) => etapasBuscadas.includes(c.etapa) && Math.abs(c.at - t) < 5 * 60_000)
  }
  const agendaAt = instante(leadRow.agenda_at)
  if (agendaAt && !cubierto(agendaAt, ['agendado', 'agenda_set'])) {
    eventos.push({
      id: `lead-agenda-${leadId}`, at: agendaAt, tipo: 'etapa', titulo: 'Marcado como agendado',
      detalle: null, actor: null, fuente: 'lead', enlace: null, aviso: null,
    })
  }
  const cerradoAt = instante(leadRow.closed_at)
  if (cerradoAt) {
    const valorCierre = monto(leadRow.close_value)
    if (!cubierto(cerradoAt, ['cierre', 'cliente', 'closed_won']) || valorCierre) {
      eventos.push({
        id: `lead-cierre-${leadId}`, at: cerradoAt, tipo: 'cierre', titulo: 'Marcado como cierre',
        detalle: valorCierre ? `Valor: ${valorCierre}` : null, actor: null, fuente: 'lead', enlace: null, aviso: null,
      })
    }
  }

  // ── Interacciones de ManyChat ────────────────────────────────────────────
  const interacciones = valor(rInteracciones) ?? []
  for (const i of interacciones) {
    const cta = (i.content_id ? keywordPorPieza.get(String(i.content_id)) : null) ?? texto(i.keyword_used) ?? 'sin pieza'
    const tocado = instante(i.bot_triggered_at) ?? instante(i.created_at)
    if (tocado) {
      eventos.push({
        id: `interaccion-cta-${i.id}`, at: tocado, tipo: 'cta', titulo: `Tocó el CTA ${cta}`,
        detalle: null, actor: null, fuente: 'interacciones', enlace: null, aviso: null,
      })
    }
    const respondio = instante(i.prospect_responded_at)
    if (respondio) {
      eventos.push({
        id: `interaccion-resp-${i.id}`, at: respondio, tipo: 'respuesta', titulo: 'Respondió en el chat',
        detalle: `CTA ${cta}`, actor: null, fuente: 'interacciones', enlace: null, aviso: null,
      })
    }
    const calificado = instante(i.qualified_at)
    if (calificado) {
      const datos = i.prequalification_data && typeof i.prequalification_data === 'object'
        ? Object.entries(i.prequalification_data as Record<string, unknown>)
        : []
      eventos.push({
        id: `interaccion-calif-${i.id}`, at: calificado, tipo: 'calificado', titulo: 'Calificado por el flujo de ManyChat',
        detalle: unir([`CTA ${cta}`, ...datos.slice(0, 4).map(([k, v]) => `${prettify(k)}: ${String(v).replace(/_/g, ' ')}`)]),
        actor: null, fuente: 'interacciones', enlace: null, aviso: null,
      })
    }
  }

  // ── Llamadas al webhook de ManyChat ──────────────────────────────────────
  for (const ev of valor(rManychat) ?? []) eventos.push(ev)

  // ── Agendas ──────────────────────────────────────────────────────────────
  const ahora = Date.now()
  const diasConAgenda = new Map<string, number>()
  for (const a of agendas) {
    const dia = texto(a.fecha_agenda) ?? (instante(a.hora_agenda)?.slice(0, 10) ?? null)
    if (dia) diasConAgenda.set(dia, (diasConAgenda.get(dia) ?? 0) + 1)
  }

  for (const a of agendas) {
    const id = String(a.id)
    const hora = instante(a.hora_agenda)
    const cancelada = instante(a.cancelada_at)
    const estado = texto(a.estado)
    const dia = texto(a.fecha_agenda) ?? hora?.slice(0, 10) ?? null
    const canal = a.calendly_uuid ? 'Calendly' : a.google_event_id ? 'Google Calendar' : 'cargada a mano'
    const avisoNombre = a.match_metodo === 'nombre' ? 'Asociado por nombre: revisa que sea la misma persona' : null
    const avisoDuplicada = dia && (diasConAgenda.get(dia) ?? 0) > 1 ? 'Hay otra agenda de este lead el mismo día (posible duplicado)' : null

    const creadaAt = instante(a.created_at)
    if (creadaAt) {
      eventos.push({
        id: `agenda-creada-${id}`, at: creadaAt, tipo: 'agenda', titulo: 'Agendó una llamada',
        detalle: unir([
          hora ? `Para ${fechaHoraCl(hora)}` : dia ? `Para el ${dia}` : null,
          `Vía ${canal}`,
          texto(a.email_lead) ? `Reservó con ${a.email_lead}` : null,
          texto(a.setter) ? `Setter: ${a.setter}` : null,
        ]),
        actor: null, fuente: 'agenda', enlace: null, aviso: unir([avisoNombre, avisoDuplicada], '. '),
      })
    }

    const notetaker = instante(a.notetaker_invitada_at)
    if (notetaker) {
      eventos.push({
        id: `agenda-notetaker-${id}`, at: notetaker, tipo: 'agenda', titulo: 'Se invitó al notetaker a la reunión',
        detalle: null, actor: 'Automático', fuente: 'agenda', enlace: null, aviso: null,
      })
    }

    if (cancelada) {
      eventos.push({
        id: `agenda-cancelada-${id}`, at: cancelada, tipo: 'cancelada', titulo: 'Canceló la llamada',
        detalle: hora ? `Era para ${fechaHoraCl(hora)}` : null, actor: null, fuente: 'agenda', enlace: null, aviso: null,
      })
    }

    const triajeAt = instante(a.triaje_at)
    if (triajeAt) {
      const ficha = (a.triaje ?? null) as Partial<FichaTriaje> | null
      eventos.push({
        id: `agenda-triaje-${id}`, at: triajeAt, tipo: 'triaje', titulo: 'Ficha de triaje guardada',
        detalle: ficha ? unir([
          ficha.califica ? `Califica: ${etiquetaDe(CALIFICA_OPCIONES, ficha.califica)}` : null,
          ficha.temperatura ? `Temperatura: ${etiquetaDe(TEMPERATURA_OPCIONES, ficha.temperatura)}` : null,
          ficha.prioridad ? `Prioridad: ${etiquetaDe(PRIORIDAD_OPCIONES, ficha.prioridad)}` : null,
        ]) : null,
        actor: actorDe(usuarios, a.triaje_por), fuente: 'agenda', enlace: null, aviso: null,
      })
    }
    const leidoAt = instante(a.triaje_leido_at)
    if (leidoAt) {
      eventos.push({
        id: `agenda-triaje-leido-${id}`, at: leidoAt, tipo: 'triaje', titulo: 'El closer leyó la ficha de triaje',
        detalle: null, actor: null, fuente: 'agenda', enlace: null, aviso: null,
      })
    }

    // La llamada misma, en su hora. Una futura queda arriba como "programada".
    const momentoLlamada = hora ?? (dia ? instante(`${dia}T12:00:00Z`) : null)
    if (momentoLlamada && !cancelada) {
      const pasada = new Date(momentoLlamada).getTime() <= ahora
      const conResultado = estado && estado !== 'Pendiente'
      if (pasada || conResultado) {
        eventos.push({
          id: `agenda-llamada-${id}`, at: momentoLlamada, tipo: conResultado && estado === 'Cerrado' ? 'cierre' : 'llamada',
          titulo: conResultado ? `Llamada: ${estado}` : 'Hora de la llamada (sin resultado cargado)',
          detalle: unir([
            texto(a.closer) ? `Closer: ${a.closer}` : null,
            texto(a.programa_ofrecido) ? `Programa: ${a.programa_ofrecido}` : null,
            texto(a.forma_de_cierre) ? `Forma de cierre: ${a.forma_de_cierre}` : null,
            monto(a.monto_upfront) ? `Upfront: ${monto(a.monto_upfront)}` : null,
            monto(a.monto_facturacion) ? `Facturación: ${monto(a.monto_facturacion)}` : null,
            texto(a.objecion) && estado !== 'Cerrado' ? `Objeción: ${recortar(texto(a.objecion), 120)}` : null,
          ]),
          actor: null, fuente: 'agenda', enlace: null, aviso: null,
        })
      } else {
        eventos.push({
          id: `agenda-programada-${id}`, at: momentoLlamada, tipo: 'agenda', titulo: 'Llamada programada',
          detalle: unir([texto(a.closer) ? `Closer: ${a.closer}` : null]),
          actor: null, fuente: 'agenda', enlace: enlaceSeguro(a.link_reunion, 'Link de la reunión'), aviso: null,
        })
      }
    }

    const fathomAt = instante(a.fathom_sincronizado_at)
    if (fathomAt) {
      eventos.push({
        id: `agenda-fathom-${id}`, at: fathomAt, tipo: 'grabacion', titulo: 'Grabación de Fathom asociada',
        detalle: recortar(texto(a.fathom_resumen), 220), actor: 'Automático', fuente: 'agenda',
        enlace: enlaceSeguro(a.link_reporte, 'Ver grabación'), aviso: null,
      })
    }

    const aprobadoAt = instante(a.reporte_aprobado_at)
    if (aprobadoAt) {
      eventos.push({
        id: `agenda-reporte-${id}`, at: aprobadoAt, tipo: 'reporte', titulo: 'Reporte de la llamada aprobado',
        detalle: null, actor: actorDe(usuarios, a.reporte_aprobado_por), fuente: 'agenda', enlace: null, aviso: null,
      })
    }
  }

  // ── Tareas del pipeline ──────────────────────────────────────────────────
  for (const t of valor(rTareas) ?? []) {
    const nombre = NOMBRE_TAREA[String(t.tipo)] ?? String(t.tipo)
    const agenda = agendaPorId.get(String(t.agenda_record_id))
    const pospuesta = numero(t.pospuesta_veces) ?? 0
    const creadaAt = instante(t.created_at)
    if (creadaAt) {
      eventos.push({
        id: `tarea-creada-${t.id}`, at: creadaAt, tipo: 'tarea', titulo: `Tarea creada: ${nombre}`,
        detalle: unir([
          t.estado === 'pendiente' ? 'Sigue pendiente' : null,
          pospuesta > 0 ? `Pospuesta ${pospuesta} ${pospuesta === 1 ? 'vez' : 'veces'}` : null,
        ]),
        actor: 'Automático', fuente: 'tareas', enlace: null, aviso: null,
      })
    }
    const completadaAt = instante(t.completada_at)
    if (completadaAt) {
      const descartada = t.estado === 'descartada'
      eventos.push({
        id: `tarea-cerrada-${t.id}`, at: completadaAt, tipo: 'tarea',
        titulo: descartada ? `Tarea descartada: ${nombre}` : `Tarea completada: ${nombre}`,
        detalle: null,
        actor: actorDe(usuarios, t.completada_por) ?? 'Automático',
        fuente: 'tareas', enlace: null,
        // Pasó en producción: tareas de triaje marcadas como hechas sin que
        // exista la ficha. Que se note, porque "hecha" no significa triaje.
        aviso: !descartada && t.tipo === 'triaje_agenda' && agenda && !agenda.triaje_at
          ? 'Se marcó como hecha sin guardar la ficha de triaje'
          : null,
      })
    }
    const escaladaAt = instante(t.escalada_at)
    if (escaladaAt) {
      eventos.push({
        id: `tarea-escalada-${t.id}`, at: escaladaAt, tipo: 'tarea', titulo: `Tarea escalada: ${nombre}`,
        detalle: null, actor: 'Automático', fuente: 'tareas', enlace: null, aviso: null,
      })
    }
  }

  // ── Grabaciones de Fathom (tabla nueva) ──────────────────────────────────
  const enlacesDeAgenda = new Set(agendas.map((a) => texto(a.link_reporte)).filter(Boolean))
  for (const g of valor(rGrabaciones) ?? []) {
    const url = texto(g.share_url) ?? texto(g.url) ?? texto(g.link)
    if (url && enlacesDeAgenda.has(url)) continue
    const at = instante(g.grabada_at) ?? instante(g.recording_start_time) ?? instante(g.inicio) ?? instante(g.created_at)
    if (!at) continue
    eventos.push({
      id: `fathom-${g.id}`, at, tipo: 'grabacion', titulo: 'Grabación de Fathom',
      detalle: recortar(texto(g.titulo) ?? texto(g.title), 120), actor: null, fuente: 'fathom',
      enlace: enlaceSeguro(url, 'Ver grabación'), aviso: null,
    })
  }

  // ── Llamadas de ventas y programa ────────────────────────────────────────
  for (const c of valor(rLlamadas) ?? []) {
    const at = instante(c.scheduled_at) ?? instante(c.started_at) ?? instante(c.created_at)
    if (!at) continue
    const minutos = numero(c.duration_seconds)
    eventos.push({
      id: `llamada-${c.id}`, at, tipo: 'llamada', titulo: 'Llamada de ventas registrada',
      detalle: unir([
        texto(c.outcome) ? `Resultado: ${RESULTADO_LLAMADA[String(c.outcome)] ?? c.outcome}` : null,
        minutos ? `${Math.round(minutos / 60)} min` : null,
        recortar(texto(c.next_steps), 120),
      ]),
      actor: actorDe(usuarios, c.caller_id), fuente: 'llamadas',
      enlace: enlaceSeguro(c.fathom_call_url, 'Ver grabación'), aviso: null,
    })
  }

  for (const s of valor(rAlumnos) ?? []) {
    const at = instante(s.created_at)
    if (!at) continue
    eventos.push({
      id: `alumno-${s.id}`, at, tipo: 'alumno', titulo: 'Pasó a ser alumno del programa',
      detalle: texto(s.start_date) ? `Inicio: ${s.start_date}` : null,
      actor: null, fuente: 'programa', enlace: null, aviso: null,
    })
  }

  // Más reciente primero. Con la misma hora se respeta el orden de armado, que
  // ya sigue la secuencia lógica (tocó el CTA antes de responder).
  const orden = new Map(eventos.map((e, i) => [e.id, i]))
  eventos.sort((a, b) => (b.at.localeCompare(a.at)) || ((orden.get(b.id) ?? 0) - (orden.get(a.id) ?? 0)))

  // ── Resumen para la cabecera y el panel lateral ──────────────────────────
  const conCalificacion = [...interacciones]
    .reverse()
    .find((i) => i.prequalification_data && typeof i.prequalification_data === 'object' && Object.keys(i.prequalification_data as object).length > 0)
  const interaccionDelLead = interacciones.find((i) => i.id === leadRow.interaction_id)
  const calificacion = (interaccionDelLead?.prequalification_data && Object.keys(interaccionDelLead.prequalification_data as object).length > 0
    ? interaccionDelLead.prequalification_data
    : conCalificacion?.prequalification_data ?? null) as Record<string, unknown> | null

  const resumenAgendas: AgendaResumen[] = agendas.map((a) => {
    const respuestas: Record<string, string> = {}
    if (a.respuestas_formulario && typeof a.respuestas_formulario === 'object') {
      for (const [k, v] of Object.entries(a.respuestas_formulario as Record<string, unknown>)) {
        const t = texto(v)
        if (t) respuestas[k] = t
      }
    }
    return {
      id: String(a.id),
      horaAgenda: instante(a.hora_agenda),
      fechaAgenda: texto(a.fecha_agenda),
      estado: texto(a.estado),
      matchMetodo: texto(a.match_metodo),
      respuestas,
      fathomResumen: texto(a.fathom_resumen),
      linkReporte: enlaceSeguro(a.link_reporte, 'Ver grabación')?.url ?? null,
      cancelada: !!a.cancelada_at,
    }
  })

  const setterId = texto(leadRow.assigned_to)
  const lead: LeadResumen = {
    id: leadId,
    clientId,
    clientName: texto(cliente?.name),
    fullName: texto(leadRow.full_name),
    igUsername: texto(leadRow.ig_username),
    email: texto(leadRow.email),
    phone: texto(leadRow.phone_e164) ?? texto(leadRow.phone),
    stage: texto(leadRow.stage),
    stageLabel: texto(leadRow.stage) ? etiquetaEtapa(leadRow.stage) : null,
    setterName: setterId ? usuarios.get(setterId) ?? null : null,
    createdAt: creadoAt,
    origen: unir([origenLead, anuncio ? `anuncio ${anuncio}` : null]),
    lostReason: texto(leadRow.lost_reason),
    calificacion,
    agendas: resumenAgendas,
  }

  return { lead, eventos, fuentesNoDisponibles: [...faltantes] }
}

/**
 * Las llamadas del webhook de ManyChat de esta persona.
 *
 * Primero por webhook_logs.lead_id (migración 075). Si la columna no existe o
 * todavía no hay filas enlazadas, por el usuario de IG del payload, quedándose
 * solo con las piezas de este cliente: la misma persona puede haber escrito a
 * otra cuenta que también usa ManyChat.
 *
 * Va con el cliente admin porque la tabla no debe depender de estar abierta a
 * anon (hoy lo está, y eso se va a cerrar). Solo se llama después de
 * assertCanViewLead. No es un export: en un archivo 'use server' cada export
 * es un endpoint público.
 */
async function leerManychat({
  leadId,
  igUsername,
  piezasDelCliente,
  faltantes,
}: {
  leadId: string
  igUsername: string | null
  piezasDelCliente: Promise<Fila[] | null>
  faltantes: Set<string>
}): Promise<EventoLead[]> {
  const fuente = 'Llamadas de ManyChat'
  try {
    const admin = createAdminClient()
    const campos = 'id, received_at, texto:payload->>last_input_text, chat:payload->>live_chat_url, pieza:payload->>pieceId, clasificacion:payload->>clasificacion'

    let filas: Fila[] = []
    let porLead = false
    const r1 = await admin
      .from('webhook_logs')
      .select(campos)
      .eq('source', 'manychat')
      .eq('lead_id', leadId)
      .order('received_at', { ascending: false })
      .limit(200)
    if (r1.error && !esEsquemaFaltante(r1.error)) {
      console.error(`[getLeadTimeline] ${fuente} (por lead_id) falló para ${leadId}:`, r1.error.code, r1.error.message)
    } else if (!r1.error && (r1.data ?? []).length > 0) {
      filas = r1.data as unknown as Fila[]
      porLead = true
    }

    if (!porLead) {
      if (!igUsername) return []
      const variantes = [...new Set([igUsername, igUsername.toLowerCase()])]
      const r2 = await admin
        .from('webhook_logs')
        .select(campos)
        .eq('source', 'manychat')
        .in('payload->>ig_username', variantes)
        .order('received_at', { ascending: false })
        .limit(200)
      if (r2.error) {
        if (esEsquemaFaltante(r2.error)) faltantes.add(fuente)
        else console.error(`[getLeadTimeline] ${fuente} (por IG) falló para ${leadId}:`, r2.error.code, r2.error.message)
        return []
      }
      filas = (r2.data ?? []) as unknown as Fila[]
    }

    // En el cruce por IG solo valen las piezas de este cliente. Si las piezas
    // no cargaron, se muestra todo antes que no mostrar nada.
    let clavesDelCliente: Set<string> | null = null
    if (!porLead && filas.length > 0) {
      const piezas = await piezasDelCliente
      if (piezas) {
        clavesDelCliente = new Set(piezas.map((p) => String(p.keyword_trigger ?? '').toLowerCase()).filter(Boolean))
      }
    }

    const salida: EventoLead[] = []
    let anterior: { pieza: string; texto: string; t: number } | null = null
    for (const f of filas) {
      const at = instante(f.received_at)
      if (!at) continue
      const pieza = texto(f.pieza) ?? ''
      if (clavesDelCliente && !clavesDelCliente.has(pieza.toLowerCase())) continue
      const mensaje = texto(f.texto) ?? ''
      const t = new Date(at).getTime()
      // ManyChat suele disparar varias llamadas seguidas con el mismo último
      // mensaje (una por paso del flujo). Se muestran como una sola.
      if (anterior && anterior.pieza === pieza && anterior.texto === mensaje && Math.abs(anterior.t - t) < 10 * 60_000) continue
      anterior = { pieza, texto: mensaje, t }
      salida.push({
        id: `manychat-${f.id}`,
        at,
        tipo: 'manychat',
        titulo: pieza ? `Actividad en ManyChat (CTA ${pieza})` : 'Actividad en ManyChat',
        detalle: unir([
          mensaje ? `Último mensaje: “${recortar(mensaje, 200)}”` : null,
          texto(f.clasificacion) ? `Clasificación: ${String(f.clasificacion).replace(/_/g, ' ')}` : null,
        ]),
        actor: null,
        fuente: 'manychat',
        enlace: enlaceSeguro(f.chat, 'Abrir chat en ManyChat'),
        aviso: null,
      })
    }
    return salida
  } catch (e) {
    console.error(`[getLeadTimeline] ${fuente} lanzó para ${leadId}:`, e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * El lead de una agenda, para enlazar su historial desde modales que solo
 * conocen la agenda (el reporte de la llamada). Devuelve null si la agenda no
 * tiene lead o si quien pregunta no puede ver ese lead.
 */
export async function getEnlaceHistorialDeAgenda(agendaId: string): Promise<{ clientId: string; leadId: string } | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('agenda_records').select('lead_id').eq('id', agendaId).maybeSingle()
    const leadId = texto(data?.lead_id)
    if (!leadId) return null
    // Ver el lead lo decide la misma regla que la línea de tiempo.
    const { lead } = await assertCanViewLead(leadId)
    return { clientId: String(lead.client_id), leadId }
  } catch {
    return null
  }
}
