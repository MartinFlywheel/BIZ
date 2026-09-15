'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizarTelefono } from '@/lib/phone'
import { normalizarInstagram } from '@/lib/services/calendly-event'
import { moverLeadAAgendado } from '@/lib/services/agenda-sync'
import { aplicarResultadoAgenda } from '@/lib/services/resultado-agenda'
import { pickBalancedSetter } from '@/lib/manychat'
import {
  POSTERGACIONES_PARA_ESCALAR,
  closerDeLaAgenda,
  escalarTriaje,
  faltaMigracion,
  notificar,
  opcionesPosponer,
  usuarioPorNombre,
  type OpcionPosponer,
} from '@/lib/services/pipeline-agendas'
import {
  CALIFICA_OPCIONES,
  PRIORIDAD_OPCIONES,
  TEMPERATURA_OPCIONES,
  ESTADOS_REPORTE,
  type FichaTriaje,
  type TipoTareaSistema,
} from '@/lib/pipeline-tipos'

/**
 * Las tareas del Pipeline de Agendas: triaje, asociar lead y aprobar reporte.
 *
 * El popup global, la planilla de agendas y la pantalla de Tareas leen y
 * escriben por aquí. Todo degrada si faltan migraciones (053 o 070): el popup
 * simplemente no aparece y la planilla sigue igual.
 */

// ── Sesión ───────────────────────────────────────────────────────────────────

interface Perfil {
  id: string
  role: string
  clientId: string | null
}

/** Solo usuarios de la agencia. Un cliente del portal no toca estas tareas. */
async function perfilDeAgencia(): Promise<Perfil> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay sesión')
  const { data: perfil } = await supabase
    .from('users')
    .select('role, user_type, client_id')
    .eq('id', user.id)
    .single()
  if (!perfil || perfil.user_type !== 'agency') throw new Error('No autorizado')
  return { id: user.id, role: perfil.role as string, clientId: (perfil.client_id as string | null) ?? null }
}

// ── Lectura de tareas ────────────────────────────────────────────────────────

export interface TareaSistema {
  id: string
  tipo: TipoTareaSistema
  clientId: string
  clientName: string | null
  agendaId: string | null
  venceAt: string | null
  pospuestaVeces: number
  asignadoA: string | null
  nombreLead: string | null
  horaAgenda: string | null
  tieneLead: boolean
  instagram: string | null
  /** Calculadas en el servidor para que la regla viva en un solo lugar. */
  opcionesPosponer: OpcionPosponer[]
}

const SELECT_TAREA =
  'id, tipo, client_id, agenda_record_id, vence_at, pospuesta_veces, asignado_a, visible_desde, ' +
  'clients(name), agenda_records(nombre_lead, hora_agenda, lead_id, link_perfil)'

type FilaTarea = Record<string, unknown>

function mapearTarea(t: FilaTarea, ahora: number): TareaSistema {
  const uno = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | undefined
  const agenda = uno<{ nombre_lead?: string; hora_agenda?: string; lead_id?: string; link_perfil?: string }>(t.agenda_records)
  const cliente = uno<{ name?: string }>(t.clients)
  const venceAt = (t.vence_at as string | null) ?? null
  return {
    id: t.id as string,
    tipo: t.tipo as TipoTareaSistema,
    clientId: t.client_id as string,
    clientName: cliente?.name ?? null,
    agendaId: (t.agenda_record_id as string | null) ?? null,
    venceAt,
    pospuestaVeces: (t.pospuesta_veces as number) ?? 0,
    asignadoA: (t.asignado_a as string | null) ?? null,
    nombreLead: agenda?.nombre_lead ?? null,
    horaAgenda: agenda?.hora_agenda ?? null,
    tieneLead: !!agenda?.lead_id,
    instagram: normalizarInstagram(agenda?.link_perfil),
    // El reporte no se pospone con las reglas del triaje: vencido o no, se
    // puede dejar para más tarde, pero sin opciones libres.
    opcionesPosponer: t.tipo === 'reporte_llamada'
      ? [{ etiqueta: '1 hora', minutos: 60 }]
      : opcionesPosponer(venceAt, ahora),
  }
}

/**
 * Lo que el popup le muestra a la persona que tiene la sesión abierta.
 *
 * Suena solo para el responsable (ver 039): lo asignado a esta persona y, si es
 * admin, lo que no tiene dueño. Un setter ve además las asociaciones sin dueño
 * de su cliente.
 *
 * Solo cuenta visible_desde. Antes lo vencido se mostraba aunque se hubiera
 * pospuesto, y un reporte que nació vencido no se iba nunca del popup: el botón
 * posponía en la base pero el aviso seguía ahí. Un triaje vencido igual no se
 * puede posponer (no se le ofrece la opción), así que esa regla sobraba.
 */
export async function getMisTareas(): Promise<TareaSistema[]> {
  let perfil: Perfil
  try {
    perfil = await perfilDeAgencia()
  } catch {
    return []
  }

  const supabase = await createClient()
  const ahora = Date.now()
  const ahoraIso = new Date(ahora).toISOString()

  // El filtro por dueño va en la consulta y no después: con el límite aplicado
  // antes, cincuenta tareas de otras personas bastaban para que las propias no
  // aparecieran nunca.
  const esAdmin = perfil.role === 'admin'
  const dueno = esAdmin
    ? `asignado_a.eq.${perfil.id},asignado_a.is.null`
    : perfil.role === 'setter' && perfil.clientId
      ? `asignado_a.eq.${perfil.id},and(asignado_a.is.null,tipo.eq.asociar_lead,client_id.eq.${perfil.clientId})`
      : `asignado_a.eq.${perfil.id}`

  const { data, error } = await supabase
    .from('system_tasks')
    .select(SELECT_TAREA)
    .eq('estado', 'pendiente')
    .lte('visible_desde', ahoraIso)
    .or(dueno)
    .order('vence_at', { ascending: true, nullsFirst: false })
    .limit(50)

  if (error) {
    if (!faltaMigracion(error)) console.error(`[triaje] no se pudieron leer las tareas: ${error.message}`)
    return []
  }

  return ((data ?? []) as unknown as FilaTarea[]).map((t) => mapearTarea(t, ahora))
}

/**
 * Todas las tareas pendientes de un cliente, para la pantalla de Tareas.
 *
 * Aquí sí se ven las de todos (incluidas las pospuestas): el director ve un
 * solo lugar con lo de Notion y lo del sistema.
 */
export async function getTareasDelCliente(clientId: string): Promise<(TareaSistema & { asignadoNombre: string | null; pospuestaHasta: string | null })[]> {
  await perfilDeAgencia()
  const supabase = await createClient()
  const ahora = Date.now()

  const { data, error } = await supabase
    .from('system_tasks')
    .select(`${SELECT_TAREA}, users:asignado_a(full_name)`)
    .eq('client_id', clientId)
    .eq('estado', 'pendiente')
    .order('vence_at', { ascending: true, nullsFirst: false })
    .limit(100)

  if (error) {
    if (!faltaMigracion(error)) console.error(`[triaje] tareas del cliente: ${error.message}`)
    return []
  }

  return ((data ?? []) as unknown as FilaTarea[]).map((t) => {
    const u = (Array.isArray(t.users) ? t.users[0] : t.users) as { full_name?: string } | undefined
    const visible = t.visible_desde as string | null
    return {
      ...mapearTarea(t, ahora),
      asignadoNombre: u?.full_name ?? null,
      pospuestaHasta: visible && new Date(visible).getTime() > ahora ? visible : null,
    }
  })
}

/** Las tareas pendientes de un grupo de agendas, para las columnas de la planilla. */
export async function getTareasDeAgendas(
  agendaIds: string[]
): Promise<{ agendaId: string; tipo: TipoTareaSistema; venceAt: string | null }[]> {
  if (agendaIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('system_tasks')
    .select('agenda_record_id, tipo, vence_at')
    .in('agenda_record_id', agendaIds)
    .eq('estado', 'pendiente')
  if (error) return []
  return (data ?? []).map((t) => ({
    agendaId: t.agenda_record_id as string,
    tipo: t.tipo as TipoTareaSistema,
    venceAt: (t.vence_at as string | null) ?? null,
  }))
}

// ── Posponer y reasignar ─────────────────────────────────────────────────────

/**
 * Posterga una tarea. La regla la valida el servidor, no el botón: si la tarea
 * venció mientras el popup estaba abierto, el botón viejo no puede posponerla.
 *
 * No se toca vence_at: si posponer corriera el vencimiento se podría postergar
 * para siempre sin quedar nunca atrasado. A la tercera postergación, escala.
 */
export async function posponerTarea(taskId: string, etiqueta: string): Promise<{ ok: boolean; error?: string }> {
  await perfilDeAgencia()
  const supabase = await createClient()

  const { data: tarea, error } = await supabase
    .from('system_tasks')
    .select('id, tipo, client_id, agenda_record_id, vence_at, pospuesta_veces, escalada_at')
    .eq('id', taskId)
    .maybeSingle()
  if (error || !tarea) return { ok: false, error: 'No se encontró la tarea' }

  // Se valida por la etiqueta y los minutos se recalculan aquí: "Mañana 9:00"
  // da minutos distintos en el navegador y en el servidor aunque sea el mismo
  // momento, y comparar minutos rechazaba la postergación.
  const permitidas = tarea.tipo === 'reporte_llamada'
    ? [{ etiqueta: '1 hora', minutos: 60 }]
    : opcionesPosponer(tarea.vence_at as string | null)
  const opcion = permitidas.find((o) => o.etiqueta === etiqueta)
  if (!opcion) {
    return { ok: false, error: permitidas.length === 0 ? 'La tarea venció: ya no se puede posponer.' : 'Esa postergación ya no está disponible.' }
  }
  const minutos = opcion.minutos

  const veces = ((tarea.pospuesta_veces as number) ?? 0) + 1
  const { error: errorUpdate } = await supabase
    .from('system_tasks')
    .update({ visible_desde: new Date(Date.now() + minutos * 60_000).toISOString(), pospuesta_veces: veces })
    .eq('id', taskId)
  if (errorUpdate) return { ok: false, error: errorUpdate.message }

  if (tarea.tipo === 'triaje_agenda' && veces >= POSTERGACIONES_PARA_ESCALAR && !tarea.escalada_at) {
    await escalarTriaje(
      createAdminClient(),
      {
        id: tarea.id as string,
        client_id: tarea.client_id as string,
        agenda_record_id: (tarea.agenda_record_id as string | null) ?? null,
        pospuesta_veces: veces,
      },
      'postergada'
    )
  }

  return { ok: true }
}

export interface Responsable {
  id: string
  nombre: string
  rol: string
}

/** A quién se puede reasignar una tarea de este cliente. */
export async function getResponsables(clientId: string): Promise<Responsable[]> {
  await perfilDeAgencia()
  const supabase = await createClient()
  const [{ data }, { data: asignados }] = await Promise.all([
    supabase.from('users').select('id, full_name, role, client_id').eq('user_type', 'agency').eq('is_active', true),
    // La dirección de ventas y los closers se asignan por team_assignments y
    // pueden no tener client_id: sin esto no aparecían para reasignarles.
    supabase.from('team_assignments').select('user_id').eq('client_id', clientId),
  ])
  const delEquipo = new Set((asignados ?? []).map((a) => a.user_id as string))
  return (data ?? [])
    .filter((u) => u.role === 'admin' || u.client_id === clientId || delEquipo.has(u.id as string))
    .map((u) => ({ id: u.id as string, nombre: (u.full_name as string) ?? 'Sin nombre', rol: u.role as string }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export async function reasignarTarea(taskId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const yo = await perfilDeAgencia()
  const supabase = await createClient()
  const { data: tarea, error } = await supabase
    .from('system_tasks')
    .update({ asignado_a: userId, visible_desde: new Date().toISOString() })
    .eq('id', taskId)
    .select('agenda_record_id, tipo, agenda_records(nombre_lead)')
    .maybeSingle()
  if (error || !tarea) return { ok: false, error: error?.message ?? 'No se encontró la tarea' }

  if (userId !== yo.id) {
    const agenda = (Array.isArray(tarea.agenda_records) ? tarea.agenda_records[0] : tarea.agenda_records) as { nombre_lead?: string } | undefined
    const que = tarea.tipo === 'asociar_lead' ? 'Asociar lead' : tarea.tipo === 'reporte_llamada' ? 'Aprobar reporte' : 'Triaje'
    await notificar(createAdminClient(), [userId], {
      titulo: `Te reasignaron: ${que}`,
      cuerpo: agenda?.nombre_lead ?? 'Agenda sin nombre',
      severidad: 'warning',
      agendaId: (tarea.agenda_record_id as string | null) ?? null,
    })
  }
  return { ok: true }
}

// ── Ficha de triaje ──────────────────────────────────────────────────────────

export interface DatosFicha {
  agendaId: string
  clientId: string
  nombreLead: string | null
  emailLead: string | null
  horaAgenda: string | null
  closer: string | null
  setter: string | null
  instagram: string | null
  deDondeVino: string | null
  primerCta: string | null
  todosLosCtas: string | null
  respuestas: Record<string, string>
  lead: {
    id: string
    nombre: string | null
    instagram: string | null
    etapa: string | null
    notas: string | null
    anuncio: string | null
  } | null
  historial: { agendas: number; noShows: number; cierres: number }
  ficha: FichaTriaje | null
  fichaGuardadaAt: string | null
  fichaLeidaAt: string | null
  tareaTriajeId: string | null
  venceAt: string | null
}

/** Todo lo que la mitad izquierda de la ficha muestra ya lleno. */
export async function getDatosFicha(agendaId: string): Promise<DatosFicha | null> {
  await perfilDeAgencia()
  const supabase = await createClient()

  const { data: a, error } = await supabase
    .from('agenda_records')
    .select('*')
    .eq('id', agendaId)
    .maybeSingle()
  if (error || !a) return null

  const [{ data: lead }, { data: tarea }] = await Promise.all([
    a.lead_id
      ? supabase.from('leads').select('id, full_name, ig_username, stage, notes, referral').eq('id', a.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('system_tasks')
      .select('id, vence_at')
      .eq('agenda_record_id', agendaId)
      .eq('tipo', 'triaje_agenda')
      .eq('estado', 'pendiente')
      .maybeSingle(),
  ])

  let historial = { agendas: 0, noShows: 0, cierres: 0 }
  if (a.lead_id) {
    const { data: previas } = await supabase
      .from('agenda_records')
      .select('estado')
      .eq('lead_id', a.lead_id)
      .neq('id', agendaId)
    historial = {
      agendas: previas?.length ?? 0,
      noShows: (previas ?? []).filter((p) => p.estado === 'No Show').length,
      cierres: (previas ?? []).filter((p) => p.estado === 'Cerrado').length,
    }
  }

  const referral = (lead?.referral ?? null) as { headline?: string; source_id?: string } | null

  return {
    agendaId,
    clientId: a.client_id,
    nombreLead: a.nombre_lead,
    emailLead: a.email_lead ?? null,
    horaAgenda: a.hora_agenda ?? null,
    closer: a.closer,
    setter: a.setter,
    instagram: normalizarInstagram(a.link_perfil) ?? (lead?.ig_username as string | null) ?? null,
    deDondeVino: a.de_donde_vino,
    primerCta: a.primer_cta,
    todosLosCtas: a.todos_los_ctas,
    respuestas: (a.respuestas_formulario ?? {}) as Record<string, string>,
    lead: lead
      ? {
          id: lead.id as string,
          nombre: (lead.full_name as string | null) ?? null,
          instagram: (lead.ig_username as string | null) ?? null,
          etapa: (lead.stage as string | null) ?? null,
          notas: (lead.notes as string | null) ?? null,
          anuncio: referral?.headline ?? referral?.source_id ?? null,
        }
      : null,
    historial,
    ficha: (a.triaje ?? null) as FichaTriaje | null,
    fichaGuardadaAt: a.triaje_at ?? null,
    fichaLeidaAt: a.triaje_leido_at ?? null,
    tareaTriajeId: (tarea?.id as string | undefined) ?? null,
    venceAt: (tarea?.vence_at as string | undefined) ?? null,
  }
}

/**
 * Guarda la ficha, cierra el triaje y le avisa al closer.
 *
 * Un "completado" sin entregable deja un registro diciendo que el triaje se
 * hizo cuando no se hizo. Por eso la única forma de cerrar la tarea es esta, y
 * exige los cinco campos.
 */
export async function guardarFichaTriaje(agendaId: string, ficha: FichaTriaje): Promise<{ ok: boolean; error?: string }> {
  const yo = await perfilDeAgencia()

  const valida =
    CALIFICA_OPCIONES.some((o) => o.valor === ficha.califica) &&
    TEMPERATURA_OPCIONES.some((o) => o.valor === ficha.temperatura) &&
    PRIORIDAD_OPCIONES.some((o) => o.valor === ficha.prioridad) &&
    (ficha.objecion_prevista ?? '').trim().length >= 3 &&
    (ficha.angulo ?? '').trim().length >= 10
  if (!valida) {
    return { ok: false, error: 'Completa los cinco campos. El ángulo para el closer necesita al menos una frase.' }
  }

  const supabase = await createClient()
  const ahora = new Date().toISOString()
  const limpia: FichaTriaje = {
    califica: ficha.califica,
    temperatura: ficha.temperatura,
    prioridad: ficha.prioridad,
    objecion_prevista: ficha.objecion_prevista.trim(),
    angulo: ficha.angulo.trim(),
  }

  const { data: agenda, error } = await supabase
    .from('agenda_records')
    .update({ triaje: limpia, triaje_at: ahora, triaje_por: yo.id, triaje_leido_at: null, updated_at: ahora })
    .eq('id', agendaId)
    .select('client_id, nombre_lead, hora_agenda, closer')
    .single()

  if (error) {
    return {
      ok: false,
      error: faltaMigracion(error)
        ? 'Falta correr la migración 070 en Supabase: la ficha todavía no tiene dónde guardarse.'
        : error.message,
    }
  }

  await supabase
    .from('system_tasks')
    .update({ estado: 'hecha', completada_at: ahora, completada_por: yo.id })
    .eq('agenda_record_id', agendaId)
    .eq('tipo', 'triaje_agenda')
    .eq('estado', 'pendiente')

  // El triaje termina cuando el closer lo leyó, no cuando se guarda.
  const admin = createAdminClient()
  const closer = await closerDeLaAgenda(admin, agenda.client_id, agenda.closer)
  // Si quien hace el triaje es también quien toma la llamada (hoy pasa con la
  // dirección de ventas), ya la leyó al escribirla.
  if (closer === yo.id) {
    await supabase.from('agenda_records').update({ triaje_leido_at: ahora }).eq('id', agendaId)
  }
  if (closer && closer !== yo.id) {
    const cuando = agenda.hora_agenda
      ? new Date(agenda.hora_agenda).toLocaleString('es-CL', {
          timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : 'sin hora'
    await notificar(admin, [closer], {
      titulo: `Ficha lista: ${agenda.nombre_lead ?? 'agenda'}`,
      cuerpo: `Llamada ${cuando}. Prioridad ${limpia.prioridad}. Ángulo: ${limpia.angulo.slice(0, 180)}`,
      severidad: limpia.prioridad === 'alta' ? 'warning' : 'info',
      agendaId,
    })
  }

  revalidatePath('/clients')
  return { ok: true }
}

/**
 * El closer abrió la ficha.
 *
 * Solo cuenta el closer de esa agenda: si la marcara cualquiera que abre el
 * detalle (otro admin, un setter), "leída" dejaría de significar que quien
 * toma la llamada la vio.
 */
export async function marcarFichaLeida(agendaId: string): Promise<void> {
  const yo = await perfilDeAgencia()
  const supabase = await createClient()
  const { data: agenda } = await supabase
    .from('agenda_records')
    .select('client_id, closer, triaje, triaje_leido_at')
    .eq('id', agendaId)
    .maybeSingle()
  if (!agenda?.triaje || agenda.triaje_leido_at) return

  const closer = await closerDeLaAgenda(createAdminClient(), agenda.client_id, agenda.closer)
  if (closer !== yo.id) return

  await supabase
    .from('agenda_records')
    .update({ triaje_leido_at: new Date().toISOString() })
    .eq('id', agendaId)
    .is('triaje_leido_at', null)
}

// ── Asociar el lead ──────────────────────────────────────────────────────────

export interface CandidatoLead {
  id: string
  nombre: string | null
  instagram: string | null
  etapa: string | null
  motivo: string
  actividadAt: string | null
  puntaje: number
}

/** Palabras del nombre que sirven para buscar: sin tildes y de 3 letras o más. */
function palabrasDelNombre(nombre: string | null): string[] {
  if (!nombre) return []
  return [...new Set(
    nombre
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-zñ]+/)
      .filter((p) => p.length >= 3)
  )].slice(0, 3)
}

/**
 * Los candidatos que el CRM sugiere para una agenda sin lead.
 *
 * El setter no busca: confirma. Se cruzan Instagram, correo, teléfono y
 * palabras del nombre, y se ordena por qué tan fuerte es la coincidencia y
 * después por actividad reciente.
 */
export async function getCandidatosLead(agendaId: string): Promise<CandidatoLead[]> {
  await perfilDeAgencia()
  const supabase = await createClient()

  const { data: a } = await supabase
    .from('agenda_records')
    .select('client_id, nombre_lead, email_lead, link_perfil, respuestas_formulario')
    .eq('id', agendaId)
    .maybeSingle()
  if (!a) return []

  const respuestas = (a.respuestas_formulario ?? {}) as Record<string, string>
  const preguntaTel = Object.keys(respuestas).find((k) => /tel[eé]fono|celular|whatsapp|phone|m[oó]vil/i.test(k))
  const preguntaIg = Object.keys(respuestas).find((k) => /instagram|\big\b/i.test(k))
  const telefono = normalizarTelefono(preguntaTel ? respuestas[preguntaTel] : null)
  const ig = normalizarInstagram(a.link_perfil) ?? normalizarInstagram(preguntaIg ? respuestas[preguntaIg] : null)

  const campos = 'id, full_name, ig_username, email, phone_e164, stage, updated_at'
  const base = () => supabase.from('leads').select(campos).eq('client_id', a.client_id)

  const palabras = palabrasDelNombre(a.nombre_lead)
  const consultas = [
    ig ? base().ilike('ig_username', ig).limit(3) : null,
    a.email_lead ? base().ilike('email', a.email_lead).limit(3) : null,
    telefono ? base().eq('phone_e164', telefono).limit(3) : null,
    ...palabras.map((p) => base().ilike('full_name', `%${p}%`).order('updated_at', { ascending: false }).limit(8)),
  ].filter(Boolean)

  const resultados = await Promise.all(consultas)
  const porId = new Map<string, Record<string, unknown>>()
  for (const r of resultados) for (const l of (r?.data ?? []) as Record<string, unknown>[]) porId.set(l.id as string, l)

  const candidatos: CandidatoLead[] = [...porId.values()].map((l) => {
    const motivos: string[] = []
    let puntaje = 0
    if (ig && (l.ig_username as string | null)?.toLowerCase() === ig) { puntaje += 100; motivos.push('Instagram exacto') }
    if (a.email_lead && (l.email as string | null)?.toLowerCase() === a.email_lead.toLowerCase()) { puntaje += 90; motivos.push('Mismo correo') }
    if (telefono && l.phone_e164 === telefono) { puntaje += 90; motivos.push('Mismo teléfono') }
    const nombreLead = palabrasDelNombre(l.full_name as string | null)
    const comunes = palabras.filter((p) => nombreLead.includes(p)).length
    if (comunes > 0) {
      puntaje += comunes >= 2 ? 60 : 25
      motivos.push(comunes >= 2 ? 'Nombre coincide' : 'Nombre parecido')
    }
    return {
      id: l.id as string,
      nombre: (l.full_name as string | null) ?? null,
      instagram: (l.ig_username as string | null) ?? null,
      etapa: (l.stage as string | null) ?? null,
      motivo: motivos.join(' · ') || 'Coincidencia débil',
      actividadAt: (l.updated_at as string | null) ?? null,
      puntaje,
    }
  })

  return candidatos
    .filter((c) => c.puntaje > 0)
    .sort((x, y) => y.puntaje - x.puntaje || (y.actividadAt ?? '').localeCompare(x.actividadAt ?? ''))
    .slice(0, 4)
}

async function cerrarAsociacion(agendaId: string, userId: string) {
  const supabase = await createClient()
  await supabase
    .from('system_tasks')
    .update({ estado: 'hecha', completada_at: new Date().toISOString(), completada_por: userId })
    .eq('agenda_record_id', agendaId)
    .eq('tipo', 'asociar_lead')
    .eq('estado', 'pendiente')
}

/** El setter confirma uno de los candidatos. */
export async function asociarLeadAAgenda(agendaId: string, leadId: string): Promise<{ ok: boolean; error?: string }> {
  const yo = await perfilDeAgencia()
  const supabase = await createClient()

  const { data: lead } = await supabase.from('leads').select('id, client_id, ig_username').eq('id', leadId).maybeSingle()
  if (!lead) return { ok: false, error: 'No se encontró el lead' }

  const { data: agenda, error } = await supabase
    .from('agenda_records')
    .select('client_id, link_perfil, hora_agenda')
    .eq('id', agendaId)
    .maybeSingle()
  if (error || !agenda) return { ok: false, error: 'No se encontró la agenda' }
  if (agenda.client_id !== lead.client_id) return { ok: false, error: 'El lead es de otro cliente' }

  const { error: errorUpdate } = await supabase
    .from('agenda_records')
    .update({
      lead_id: leadId,
      match_metodo: 'manual',
      ...(!agenda.link_perfil && lead.ig_username ? { link_perfil: `https://instagram.com/${lead.ig_username}` } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', agendaId)
  if (errorUpdate) return { ok: false, error: errorUpdate.message }

  await moverLeadAAgendado(createAdminClient(), agenda.client_id, leadId, agenda.hora_agenda)
  await cerrarAsociacion(agendaId, yo.id)
  revalidatePath('/clients')
  return { ok: true }
}

/**
 * Ninguno coincide: se crea el lead con los datos del formulario.
 *
 * El setter asignado sale del mismo reparto balanceado que usan los webhooks de
 * ManyChat, para que el lead nuevo no quede sin dueño.
 */
export async function crearLeadDesdeAgenda(agendaId: string, instagram: string | null): Promise<{ ok: boolean; error?: string }> {
  const yo = await perfilDeAgencia()
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: a } = await supabase
    .from('agenda_records')
    .select('client_id, nombre_lead, email_lead, link_perfil, respuestas_formulario, hora_agenda')
    .eq('id', agendaId)
    .maybeSingle()
  if (!a) return { ok: false, error: 'No se encontró la agenda' }

  const ig = normalizarInstagram(instagram) ?? normalizarInstagram(a.link_perfil)
  const respuestas = (a.respuestas_formulario ?? {}) as Record<string, string>
  const preguntaTel = Object.keys(respuestas).find((k) => /tel[eé]fono|celular|whatsapp|phone|m[oó]vil/i.test(k))

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      client_id: a.client_id,
      ig_username: ig,
      full_name: a.nombre_lead,
      email: a.email_lead ?? null,
      phone: preguntaTel ? respuestas[preguntaTel] : null,
      stage: 'agendado',
      agenda_at: a.hora_agenda ?? new Date().toISOString(),
      assigned_to: await pickBalancedSetter(admin, a.client_id),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  const { error: errorUpdate } = await supabase
    .from('agenda_records')
    .update({
      lead_id: lead.id,
      match_metodo: 'manual',
      ...(ig && !a.link_perfil ? { link_perfil: `https://instagram.com/${ig}` } : {}),
    })
    .eq('id', agendaId)
  if (errorUpdate) {
    // Sin esto el lead quedaba huérfano y reintentar creaba otro igual.
    await admin.from('leads').delete().eq('id', lead.id)
    return { ok: false, error: errorUpdate.message }
  }

  await cerrarAsociacion(agendaId, yo.id)
  revalidatePath('/clients')
  revalidatePath('/leads')
  return { ok: true }
}

/**
 * Desde la ficha: pincharle al setter para que asocie el lead. El triaje no se
 * frena por esto, pero el setter se entera.
 */
export async function pedirAsociacionAlSetter(agendaId: string): Promise<{ ok: boolean; error?: string }> {
  await perfilDeAgencia()
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: a } = await supabase
    .from('agenda_records')
    .select('client_id, nombre_lead, setter')
    .eq('id', agendaId)
    .maybeSingle()
  if (!a) return { ok: false }

  let destino = await usuarioPorNombre(admin, a.client_id, a.setter)
  const destinos: string[] = []
  if (destino) destinos.push(destino)
  else {
    const { data: setters } = await admin
      .from('users')
      .select('id')
      .eq('client_id', a.client_id)
      .eq('role', 'setter')
      .eq('is_active', true)
    destinos.push(...(setters ?? []).map((s) => s.id as string))
    destino = destinos[0] ?? null
  }

  if (destinos.length === 0) {
    return { ok: false, error: 'Este cliente no tiene setters activos con cuenta en el CRM.' }
  }

  await notificar(admin, destinos, {
    titulo: `Asociar lead: ${a.nombre_lead ?? 'agenda sin nombre'}`,
    cuerpo: 'La dirección de ventas está haciendo el triaje y la agenda no tiene lead asociado.',
    severidad: 'warning',
    agendaId,
  })
  return { ok: true }
}

// ── Reporte de llamada ───────────────────────────────────────────────────────

export interface DatosReporte {
  agendaId: string
  nombreLead: string | null
  horaAgenda: string | null
  linkGrabacion: string | null
  resumen: string | null
  estadoReporte: string | null
  estado: string | null
  objecion: string | null
  situacion_actual: string | null
  dolores: string | null
  preguntas_no_resueltas: string | null
  aporte_a_mkt: string | null
  deDondeVino: string | null
  monto_facturacion: number | null
  monto_upfront: number | null
}

export async function getDatosReporte(agendaId: string): Promise<DatosReporte | null> {
  await perfilDeAgencia()
  const supabase = await createClient()
  const { data: a } = await supabase.from('agenda_records').select('*').eq('id', agendaId).maybeSingle()
  if (!a) return null
  return {
    agendaId,
    nombreLead: a.nombre_lead,
    horaAgenda: a.hora_agenda ?? null,
    linkGrabacion: a.link_reporte,
    resumen: a.fathom_resumen ?? null,
    estadoReporte: a.reporte_estado ?? null,
    estado: a.estado,
    objecion: a.objecion,
    situacion_actual: a.situacion_actual,
    dolores: a.dolores,
    preguntas_no_resueltas: a.preguntas_no_resueltas,
    aporte_a_mkt: a.aporte_a_mkt,
    deDondeVino: a.de_donde_vino,
    monto_facturacion: a.monto_facturacion ?? null,
    monto_upfront: a.monto_upfront ?? null,
  }
}

export interface CamposReporte {
  estado: string
  objecion: string | null
  situacion_actual: string | null
  dolores: string | null
  preguntas_no_resueltas: string | null
  aporte_a_mkt: string | null
  /** Total de la venta. Obligatorio si el estado es Cerrado. */
  monto_facturacion: number | null
  /** Lo que pagó al cerrar (puede ser menos que la facturación). */
  monto_upfront: number | null
}

/** Un monto del formulario: vacío o no numérico = null. */
function monto(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** La dirección de ventas corrige el borrador y lo aprueba. */
export async function aprobarReporte(agendaId: string, campos: CamposReporte): Promise<{ ok: boolean; error?: string }> {
  const yo = await perfilDeAgencia()
  if (!ESTADOS_REPORTE.includes(campos.estado as (typeof ESTADOS_REPORTE)[number])) {
    return { ok: false, error: 'Elige el estado de la llamada' }
  }
  if (!campos.aporte_a_mkt?.trim()) {
    return { ok: false, error: 'Falta el aporte a marketing: es lo que llega al panel.' }
  }

  // Cada cierre aprobado sin monto nacía con facturación y cash en 0, y el
  // Registro mostraba US$ 0 aunque hubiera ventas.
  const facturacion = monto(campos.monto_facturacion)
  const upfront = monto(campos.monto_upfront)
  if ((facturacion !== null && facturacion < 0) || (upfront !== null && upfront < 0)) {
    return { ok: false, error: 'Los montos no pueden ser negativos' }
  }
  if (campos.estado === 'Cerrado' && !(facturacion !== null && facturacion > 0)) {
    return { ok: false, error: 'Falta el monto de la venta' }
  }

  const supabase = await createClient()
  const ahora = new Date().toISOString()
  const texto = (v: string | null) => (v?.trim() ? v.trim() : null)

  const { data: anterior } = await supabase.from('agenda_records').select('estado').eq('id', agendaId).maybeSingle()

  const { error } = await supabase
    .from('agenda_records')
    .update({
      estado: campos.estado,
      objecion: texto(campos.objecion),
      situacion_actual: texto(campos.situacion_actual),
      dolores: texto(campos.dolores),
      preguntas_no_resueltas: texto(campos.preguntas_no_resueltas),
      aporte_a_mkt: texto(campos.aporte_a_mkt),
      monto_facturacion: facturacion,
      monto_upfront: upfront,
      reporte_estado: 'aprobado',
      reporte_aprobado_at: ahora,
      reporte_aprobado_por: yo.id,
      updated_at: ahora,
    })
    .eq('id', agendaId)

  if (error) {
    return {
      ok: false,
      error: faltaMigracion(error) ? 'Falta correr la migración 070 en Supabase.' : error.message,
    }
  }

  await supabase
    .from('system_tasks')
    .update({ estado: 'hecha', completada_at: ahora, completada_por: yo.id })
    .eq('agenda_record_id', agendaId)
    .eq('tipo', 'reporte_llamada')
    .eq('estado', 'pendiente')

  // El resultado aprobado llega al lead (cierre, no calificado o agendado).
  await aplicarResultadoAgenda(createAdminClient(), agendaId, {
    estadoAnterior: (anterior?.estado as string | null) ?? null,
  })

  revalidatePath('/clients')
  return { ok: true }
}

// ── Lo que recibe marketing ──────────────────────────────────────────────────

export interface FilaMarketing {
  origen: string
  agendas: number
  conFicha: number
  califican: number
  dudosos: number
  noCalifican: number
  calientes: number
  shows: number
  cierres: number
  reportesAprobados: number
  objeciones: string[]
  aportes: string[]
}

/**
 * Objeciones por campaña, calidad de lead por origen y cierre por origen.
 *
 * El cruce sale de de_donde_vino contra la ficha de triaje y el reporte
 * aprobado. Los textos (objeciones y aportes) solo se toman de reportes
 * aprobados: un borrador sin revisar no es un dato para marketing.
 */
export async function getPanelMarketing(clientId: string, dias = 60): Promise<{ filas: FilaMarketing[]; sinMigracion: boolean }> {
  await perfilDeAgencia()
  const supabase = await createClient()
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('agenda_records')
    .select('de_donde_vino, estado, triaje, reporte_estado, objecion, aporte_a_mkt, cancelada_at')
    .eq('client_id', clientId)
    .gte('fecha_agenda', desde)

  if (error) return { filas: [], sinMigracion: faltaMigracion(error) }

  const grupos = new Map<string, FilaMarketing>()
  for (const a of data ?? []) {
    if (a.cancelada_at) continue
    const origen = (a.de_donde_vino as string | null)?.trim() || 'Sin origen'
    const g = grupos.get(origen) ?? {
      origen, agendas: 0, conFicha: 0, califican: 0, dudosos: 0, noCalifican: 0, calientes: 0,
      shows: 0, cierres: 0, reportesAprobados: 0, objeciones: [], aportes: [],
    }
    g.agendas++
    const ficha = a.triaje as FichaTriaje | null
    if (ficha) {
      g.conFicha++
      if (ficha.califica === 'si') g.califican++
      if (ficha.califica === 'dudoso') g.dudosos++
      if (ficha.califica === 'no') g.noCalifican++
      if (ficha.temperatura === 'caliente') g.calientes++
    }
    if (['Show', 'Cerrado', 'No Cerrado'].includes(a.estado as string)) g.shows++
    if (a.estado === 'Cerrado') g.cierres++
    if (a.reporte_estado === 'aprobado') {
      g.reportesAprobados++
      if ((a.objecion as string | null)?.trim()) g.objeciones.push((a.objecion as string).trim())
      if ((a.aporte_a_mkt as string | null)?.trim()) g.aportes.push((a.aporte_a_mkt as string).trim())
    }
    grupos.set(origen, g)
  }

  return {
    filas: [...grupos.values()].sort((x, y) => y.agendas - x.agendas),
    sinMigracion: false,
  }
}
