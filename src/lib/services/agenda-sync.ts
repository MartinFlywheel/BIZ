import { normalizarTelefono } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'
import { parsearEventoCalendly, type EventoCalendly } from './calendly-event'
import { mismoNombre } from './nombres'
import {
  listarCambios,
  invitarAEvento,
  credencialesConfiguradas,
  type EventoGoogle,
} from './google-calendar'

/**
 * Trae las reservas de Calendly al CRM leyendo Google Calendar.
 *
 * Calendly Free no da webhooks, pero sí escribe cada reserva en el calendario
 * del cliente. Este módulo lee ese calendario cada pocos minutos y convierte
 * los eventos nuevos en filas de `agenda_records`, ya con el formulario que la
 * persona llenó al reservar. El setter solo tiene que asociar el lead cuando el
 * cruce automático no lo encontró.
 *
 * Depende de la migración 049. Si todavía no se corrió, no revienta: detecta el
 * error de columna inexistente y sale informando, igual que el resto del CRM.
 */

/** Postgres: la columna no existe → falta correr la migración 049. */
const COLUMNA_INEXISTENTE = '42703'
const FALTA_MIGRACION = 'Falta correr la migración 049-agenda-google-calendar.sql'

export interface ResumenSync {
  cliente: string
  creadas: number
  /** Solo las que cambiaron de verdad (hora, fecha o enlace). */
  actualizadas: number
  /**
   * Agendas cargadas a mano que se completaron con el evento del calendario
   * en vez de crear un duplicado.
   */
  completadas: number
  canceladas: number
  ignoradas: number
  /** Agendas creadas sin lead asociado: son las que el setter debe triar. */
  sinLead: number
  /** Eventos a los que se agregó la notetaker como invitada. */
  notetakerInvitada: number
  /** Google no devolvió nextSyncToken y la próxima vuelta relee la ventana. */
  sinSyncToken: boolean
  error: string | null
}

/** Lo que el sync necesita saber del cliente para procesar sus eventos. */
interface ContextoCliente {
  clientId: string
  calendarId: string
  /** Correo de la notetaker, o null si el cliente no la tiene configurada. */
  notetakerEmail: string | null
  /**
   * Si las columnas de la 051 existen. Cuando esa migración todavía no se
   * corrió, el sync sigue trayendo agendas y solo se salta la parte de la
   * notetaker: el módulo ya está en producción y no puede dejar de funcionar
   * esperando una migración.
   */
  notetakerDisponible: boolean
  /**
   * Si existe agenda_records.email_lead (migración 052). Mismo criterio que
   * arriba: sin esa columna el sync sigue creando agendas, solo que sin el
   * correo, y el cruce con Fathom queda para cuando la migración se corra.
   */
  emailDisponible: boolean
  /** Si existe agenda_records.cancelada_at (migración 055). */
  canceladasDisponible: boolean
  /**
   * Eventos cuya agenda alguien borró a mano. Volver a crearlos convertiría el
   * borrado en algo que se deshace solo a los diez minutos, que es lo que
   * pasaba antes de la 055.
   */
  ignorados: Set<string>
}

/** Cómo se encontró el lead. Queda guardado para poder auditar los cruces. */
type MatchMetodo = 'instagram' | 'telefono' | 'email' | 'nombre' | null

/**
 * Los datos de la reserva, juntando la descripción con el resto del evento.
 *
 * La descripción sola no alcanza: Calendly dejó de rotular "Invitee:" e
 * "Invitee Email:" en el texto, y ahora el prospecto viaja como asistente del
 * evento de Google. El formulario, en cambio, sigue viniendo en la
 * descripción. Hay que leer las dos partes.
 *
 * El titulo lo escribe Calendly como "{invitado} and {anfitrion}", asi que
 * sirve de respaldo para el nombre cuando el asistente no trae displayName.
 */
export function datosDeLaReserva(evento: EventoGoogle): EventoCalendly {
  const datos = parsearEventoCalendly(evento.description)

  // El prospecto es el asistente que no es el organizador ni la propia cuenta.
  // Las salas y recursos se descartan: no son personas.
  const invitado = (evento.attendees ?? []).find(
    (a) => !a.organizer && !a.self && !a.resource && a.email
  )

  const nombreDelTitulo = evento.summary?.split(/\s+(?:and|y)\s+/i)[0]?.trim() || null

  return {
    ...datos,
    nombre: datos.nombre ?? invitado?.displayName ?? nombreDelTitulo,
    email: datos.email ?? invitado?.email?.toLowerCase() ?? null,
  }
}

type Supabase = ReturnType<typeof createAdminClient>

function esErrorDeMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === COLUMNA_INEXISTENTE
}

/**
 * Busca a qué lead corresponde la reserva.
 *
 * En orden de confianza: Instagram (lo escribió la persona y es único),
 * teléfono (normalizado a E.164 por la migración 059; es lo que el agente
 * prellena en el enlace de Calendly), correo (exacto, pero mucha gente reserva
 * con uno distinto al que dio antes) y nombre (aproximado, el más propenso a
 * equivocarse). El método usado queda guardado para poder revisar después
 * cuáles se cruzaron por nombre, que son las dudosas.
 */
async function buscarLead(
  supabase: Supabase,
  clientId: string,
  datos: EventoCalendly
): Promise<{ leadId: string | null; metodo: MatchMetodo }> {
  if (datos.instagram) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .ilike('ig_username', datos.instagram)
      .limit(1)
      .maybeSingle()
    if (data) return { leadId: data.id, metodo: 'instagram' }
  }

  const telefono = normalizarTelefono(datos.telefono)
  if (telefono) {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .eq('phone_e164', telefono)
      .limit(1)
      .maybeSingle()
    if (data) return { leadId: data.id, metodo: 'telefono' }
    // Sin la migración 059 no existe phone_e164: se sigue con el correo, como
    // antes, en vez de tumbar el sync completo.
    if (error && !esErrorDeMigracion(error)) throw error
  }

  if (datos.email) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .ilike('email', datos.email)
      .limit(1)
      .maybeSingle()
    if (data) return { leadId: data.id, metodo: 'email' }
  }

  if (datos.nombre && datos.nombre.length >= 4) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .ilike('full_name', `%${datos.nombre}%`)
      .limit(2)
    // Si el nombre coincide con dos leads no hay forma de saber cuál es, así
    // que se deja sin asociar para que lo resuelva el setter en el triaje.
    // Asociar el equivocado es peor que no asociar nada.
    if (data && data.length === 1) return { leadId: data[0].id, metodo: 'nombre' }
  }

  return { leadId: null, metodo: null }
}

/**
 * Una reserva nueva mueve el lead a "agendado" y fija agenda_at, que es lo
 * que alimentan las métricas por etapa. Antes la agenda se creaba pero el
 * lead seguía en "calendly_enviado" hasta que alguien lo movía a mano.
 *
 * No retrocede a quien ya cerró o fue descartado, y respeta a los clientes
 * con etapas propias que no tengan "agendado". Nunca lanza: la agenda vale
 * más que la etapa.
 */
export async function moverLeadAAgendado(supabase: Supabase, clientId: string, leadId: string, inicio: string | null) {
  try {
    const [{ data: lead }, { data: cliente }] = await Promise.all([
      supabase.from('leads').select('stage').eq('id', leadId).maybeSingle(),
      supabase.from('clients').select('pipeline_stages').eq('id', clientId).maybeSingle(),
    ])
    if (!lead) return
    const noRetroceder = new Set(['agendado', 'agenda_set', 'cierre', 'cliente', 'closed_won', 'no_calificado', 'closed_lost'])
    if (noRetroceder.has(lead.stage)) return
    const etapas = (cliente?.pipeline_stages ?? null) as { id: string }[] | null
    if (etapas && etapas.length > 0 && !etapas.some((e) => e.id === 'agendado')) return

    await supabase
      .from('leads')
      .update({
        stage: 'agendado',
        agenda_at: inicio ?? new Date().toISOString(),
        next_follow_up_date: null,
        follow_up_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
  } catch (e) {
    console.error('[agenda-sync] no se pudo mover el lead a agendado:', e)
  }
}

interface FilaCliente {
  id: string
  name: string | null
  google_calendar_id: string | null
  google_calendar_sync_token: string | null
  notetaker_email: string | null
}

interface AgendaExistente {
  id: string
  comentarios: string | null
  notetaker_invitada_at: string | null
  hora_agenda: string | null
  fecha_agenda: string | null
  link_reunion: string | null
}

/**
 * La agenda ya guardada para este evento, si existe.
 *
 * Va en dos consultas literales y no en una con las columnas armadas en una
 * variable porque el cliente tipado de Supabase deduce el tipo del texto del
 * select: un select dinámico compila a un tipo de error, no a la fila.
 */
async function buscarAgendaExistente(
  supabase: Supabase,
  ctx: ContextoCliente,
  eventId: string
): Promise<AgendaExistente | null> {
  if (ctx.notetakerDisponible) {
    const { data, error } = await supabase
      .from('agenda_records')
      .select('id, comentarios, notetaker_invitada_at, hora_agenda, fecha_agenda, link_reunion')
      .eq('client_id', ctx.clientId)
      .eq('google_event_id', eventId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('agenda_records')
    .select('id, comentarios, hora_agenda, fecha_agenda, link_reunion')
    .eq('client_id', ctx.clientId)
    .eq('google_event_id', eventId)
    .maybeSingle()
  if (error) throw error
  // Sin la 051 la columna no existe; se reporta como "no invitada", que es lo
  // correcto: tampoco se va a invitar a nadie.
  return data ? { ...data, notetaker_invitada_at: null } : null
}

export interface AgendaManual {
  id: string
  lead_id: string | null
  nombre_lead: string | null
  email_lead: string | null
  link_reunion: string | null
  link_perfil: string | null
  de_donde_vino: string | null
  respuestas_formulario: Record<string, string> | null
}

/**
 * La agenda cargada a mano que corresponde a esta reserva, si hay una sola.
 *
 * Mismo cliente, sin evento del calendario, no cancelada, mismo día, y mismo
 * lead o mismo nombre normalizado ("Paola barrera" = "Paola Barrera"). Si hay
 * dos candidatas no se elige ninguna: fusionar con la equivocada mezcla dos
 * llamadas distintas y eso es peor que un duplicado visible.
 *
 * La usan el sync del calendario y el webhook de Calendly. Nunca lanza: si la
 * consulta falla se sigue como antes, creando la agenda.
 */
export async function buscarAgendaManualEquivalente(
  supabase: Supabase,
  clientId: string,
  opciones: {
    fecha: string | null
    leadId: string | null
    nombre: string | null
    calendlyUuid: string | null
    canceladasDisponible: boolean
  }
): Promise<AgendaManual | null> {
  if (!opciones.fecha || (!opciones.leadId && !opciones.nombre)) return null

  let query = supabase
    .from('agenda_records')
    .select('id, lead_id, nombre_lead, email_lead, link_reunion, link_perfil, de_donde_vino, respuestas_formulario, calendly_uuid')
    .eq('client_id', clientId)
    .is('google_event_id', null)
    .eq('fecha_agenda', opciones.fecha)
  if (opciones.canceladasDisponible) query = query.is('cancelada_at', null)

  const { data, error } = await query
  if (error) {
    console.error(`[agenda-sync] no se pudo buscar la agenda manual equivalente: ${error.message}`)
    return null
  }

  const equivalentes = (data ?? []).filter((a) => {
    // Otra reserva de Calendly: no es la misma llamada.
    if (a.calendly_uuid && opciones.calendlyUuid && a.calendly_uuid !== opciones.calendlyUuid) return false
    if (opciones.leadId && a.lead_id) return a.lead_id === opciones.leadId
    return mismoNombre(a.nombre_lead as string | null, opciones.nombre)
  })

  if (equivalentes.length !== 1) return null
  const a = equivalentes[0]
  return {
    id: a.id as string,
    lead_id: (a.lead_id as string | null) ?? null,
    nombre_lead: (a.nombre_lead as string | null) ?? null,
    email_lead: (a.email_lead as string | null) ?? null,
    link_reunion: (a.link_reunion as string | null) ?? null,
    link_perfil: (a.link_perfil as string | null) ?? null,
    de_donde_vino: (a.de_donde_vino as string | null) ?? null,
    respuestas_formulario: (a.respuestas_formulario as Record<string, string> | null) ?? null,
  }
}

/**
 * Un evento del calendario → una fila de agenda.
 *
 * Los eventos que no vienen de Calendly (reuniones internas, bloqueos de
 * agenda, cumpleaños) se ignoran: se reconocen porque no traen el enlace de
 * cancelación que Calendly siempre escribe en la descripción.
 */
async function procesarEvento(
  supabase: Supabase,
  ctx: ContextoCliente,
  evento: EventoGoogle,
  resumen: ResumenSync
): Promise<void> {
  const { clientId } = ctx
  const existente = await buscarAgendaExistente(supabase, ctx, evento.id)

  if (evento.status === 'cancelled') {
    if (!existente) {
      resumen.ignoradas++
      return
    }
    // No se toca el estado: puede que el setter ya lo haya marcado a mano y su
    // criterio vale más que el nuestro. La cancelación se deja anotada para que
    // se vea en el triaje.
    const nota = 'Cancelada en Calendly.'
    const comentarios = existente.comentarios?.includes(nota)
      ? existente.comentarios
      : [existente.comentarios, nota].filter(Boolean).join(' ')

    // La fila no se borra: una llamada caída cuenta para el show rate, y
    // borrarla haría que las métricas mientan hacia arriba.
    await supabase
      .from('agenda_records')
      .update(
        ctx.canceladasDisponible
          ? { comentarios, cancelada_at: new Date().toISOString() }
          : { comentarios }
      )
      .eq('id', existente.id)

    // Y se cierra el triaje: no tiene sentido seguir pidiendo el Instagram de
    // una llamada que ya no va a ocurrir.
    await supabase
      .from('system_tasks')
      .update({ estado: 'descartada' })
      .eq('agenda_record_id', existente.id)
      .eq('estado', 'pendiente')

    resumen.canceladas++
    return
  }

  // Alguien borró esta agenda a propósito. Se respeta.
  if (!existente && ctx.ignorados.has(evento.id)) {
    resumen.ignoradas++
    return
  }

  const datos = datosDeLaReserva(evento)

  // Sin UUID de Calendly no es una reserva, es otra cosa que hay en la agenda.
  if (!datos.calendlyUuid) {
    resumen.ignoradas++
    return
  }

  // Los eventos de día completo traen `date` en vez de `dateTime` y no son
  // llamadas; igual se guardan, pero sin hora.
  const inicio = evento.start?.dateTime ?? null
  const enlace = evento.hangoutLink ?? evento.location ?? null

  if (existente) {
    // El evento cambió de hora (reprogramación). Solo se actualiza lo que viene
    // del calendario; lo que el setter escribió a mano no se pisa.
    //
    // Sin syncToken el sync relee la ventana completa en cada vuelta, y antes
    // reescribía todas las filas y las contaba como "actualizadas" aunque no
    // hubiera cambiado nada (12 por corrida). Ahora solo escribe si algo
    // cambió: además de ahorrar escrituras, no dispara los triggers de
    // agenda_records en vano.
    const fecha = inicio ? inicio.split('T')[0] : null
    const mismaHora =
      (!inicio && !existente.hora_agenda) ||
      (!!inicio && !!existente.hora_agenda && new Date(inicio).getTime() === new Date(existente.hora_agenda).getTime())
    const cambio = !mismaHora || existente.fecha_agenda !== fecha || (existente.link_reunion ?? null) !== enlace

    if (cambio) {
      const { error } = await supabase
        .from('agenda_records')
        .update({ hora_agenda: inicio, fecha_agenda: fecha, link_reunion: enlace })
        .eq('id', existente.id)
      if (error) throw error
      resumen.actualizadas++
    }

    // Una agenda que ya existía puede no tener la notetaker: se creó antes de
    // que el cliente la configurara, o el intento anterior falló.
    if (!existente.notetaker_invitada_at) {
      await invitarNotetaker(supabase, ctx, evento, existente.id, resumen)
    }
    return
  }

  const { leadId, metodo } = await buscarLead(supabase, clientId, datos)
  if (leadId) await moverLeadAAgendado(supabase, clientId, leadId, inicio)

  // Antes de crear: ¿el equipo ya la cargó a mano? Pasaba seguido (Laura
  // Espinal, Paola Barrera, Daniela Acuña): una fila manual con closer y estado
  // y otra del calendario con hora y correo. La grabación caía en una y el
  // equipo trabajaba en la otra.
  const fechaAgenda = inicio ? inicio.split('T')[0] : null
  const manual = await buscarAgendaManualEquivalente(supabase, clientId, {
    fecha: fechaAgenda,
    leadId,
    nombre: datos.nombre,
    calendlyUuid: datos.calendlyUuid,
    canceladasDisponible: ctx.canceladasDisponible,
  })

  if (manual) {
    // Se completa lo que viene del calendario sin pisar lo escrito a mano.
    const cambios: Record<string, unknown> = {
      google_event_id: evento.id,
      calendly_uuid: datos.calendlyUuid,
      hora_agenda: inicio,
      fecha_agenda: fechaAgenda,
      updated_at: new Date().toISOString(),
    }
    if (!manual.lead_id && leadId) {
      cambios.lead_id = leadId
      cambios.match_metodo = metodo
    }
    if (!manual.nombre_lead && datos.nombre) cambios.nombre_lead = datos.nombre
    if (ctx.emailDisponible && !manual.email_lead && datos.email) cambios.email_lead = datos.email
    if (!manual.link_reunion && enlace) cambios.link_reunion = enlace
    if (!manual.link_perfil && datos.instagram) cambios.link_perfil = `https://instagram.com/${datos.instagram}`
    if (!manual.de_donde_vino && datos.tipoEvento) cambios.de_donde_vino = datos.tipoEvento
    if (!manual.respuestas_formulario || Object.keys(manual.respuestas_formulario).length === 0) {
      cambios.respuestas_formulario = datos.respuestas
    }

    const { error } = await supabase.from('agenda_records').update(cambios).eq('id', manual.id)
    if (error) throw error

    resumen.completadas++
    if (!manual.lead_id && !leadId) resumen.sinLead++
    await invitarNotetaker(supabase, ctx, evento, manual.id, resumen)
    return
  }

  const { data: creada, error } = await supabase.from('agenda_records').insert({
    client_id: clientId,
    lead_id: leadId,
    google_event_id: evento.id,
    calendly_uuid: datos.calendlyUuid,
    nombre_lead: datos.nombre,
    // Se guarda aunque ya se haya usado para buscar el lead: es lo que después
    // permite cruzar la grabación de Fathom con esta agenda.
    ...(ctx.emailDisponible ? { email_lead: datos.email } : {}),
    link_perfil: datos.instagram ? `https://instagram.com/${datos.instagram}` : null,
    hora_agenda: inicio,
    fecha_agenda: fechaAgenda,
    fecha_agendado: (evento.created ?? new Date().toISOString()).split('T')[0],
    link_reunion: enlace,
    de_donde_vino: datos.tipoEvento,
    respuestas_formulario: datos.respuestas,
    match_metodo: metodo,
    estado: 'Pendiente',
  }).select('id').single()

  if (error) throw error

  resumen.creadas++
  if (!leadId) resumen.sinLead++

  await invitarNotetaker(supabase, ctx, evento, creada.id, resumen)
}

/**
 * Agrega a la notetaker como invitada del evento, si el cliente la configuró.
 *
 * Esto es lo que elimina el trabajo manual del director de ventas: la notetaker
 * queda invitada y Fathom entra sola a la llamada porque la ve en su calendario.
 *
 * Nunca lanza. Que no se pueda invitar es molesto —esa llamada no queda
 * grabada— pero la agenda ya está creada y perderla por esto sería peor. El
 * fallo se anota en el resumen del cron y se reintenta en la vuelta siguiente,
 * porque notetaker_invitada_at sigue en NULL.
 */
async function invitarNotetaker(
  supabase: Supabase,
  ctx: ContextoCliente,
  evento: EventoGoogle,
  agendaId: string,
  resumen: ResumenSync
): Promise<void> {
  if (!ctx.notetakerEmail || !ctx.notetakerDisponible) return

  try {
    const { agregado } = await invitarAEvento(ctx.calendarId, evento.id, ctx.notetakerEmail)

    // Se marca aunque ya estuviera invitada: el objetivo es que esté, no
    // haberla agregado nosotros. Si no, se reintentaría en cada vuelta.
    await supabase
      .from('agenda_records')
      .update({ notetaker_invitada_at: new Date().toISOString() })
      .eq('id', agendaId)

    if (agregado) resumen.notetakerInvitada++
  } catch (e) {
    const error = e as { message?: string }
    console.error(
      `[agenda-sync] no se pudo invitar a la notetaker al evento ${evento.id}: ${error.message ?? String(e)}`
    )
  }
}

/**
 * Sincroniza el calendario de un cliente.
 *
 * El syncToken se guarda al final y solo si todo salió bien: si se guardara
 * antes y el proceso fallara a la mitad, los eventos que faltaban quedarían
 * perdidos para siempre, porque Google ya no los volvería a mandar.
 */
export async function sincronizarCliente(
  clientId: string,
  nombreCliente: string,
  calendarId: string,
  syncToken: string | null,
  notetakerEmail: string | null = null,
  notetakerDisponible = false,
  emailDisponible = false,
  canceladasDisponible = false,
  ignorados: Set<string> = new Set()
): Promise<ResumenSync> {
  const supabase = createAdminClient()
  const resumen: ResumenSync = {
    cliente: nombreCliente,
    creadas: 0,
    actualizadas: 0,
    completadas: 0,
    canceladas: 0,
    ignoradas: 0,
    sinLead: 0,
    notetakerInvitada: 0,
    sinSyncToken: false,
    error: null,
  }
  const ctx: ContextoCliente = {
    clientId,
    calendarId,
    notetakerEmail,
    notetakerDisponible,
    emailDisponible,
    canceladasDisponible,
    ignorados,
  }

  try {
    let resultado = await listarCambios(calendarId, syncToken)

    // El token caducó: se relee la ventana completa. Los eventos ya guardados
    // se reconocen por google_event_id, así que releer no duplica nada.
    if (resultado.tokenExpirado) {
      resultado = await listarCambios(calendarId, null)
    }

    for (const evento of resultado.eventos) {
      await procesarEvento(supabase, ctx, evento, resumen)
    }

    if (resultado.syncToken) {
      // Antes el error de este update se ignoraba: si fallaba, el sync
      // quedaba releyendo la ventana completa para siempre sin que nadie lo
      // viera. Ahora queda en el resumen del cron.
      const { error: errorToken } = await supabase
        .from('clients')
        .update({
          google_calendar_sync_token: resultado.syncToken,
          google_calendar_synced_at: new Date().toISOString(),
        })
        .eq('id', clientId)
      if (errorToken) resumen.error = `No se guardó el syncToken: ${errorToken.message}`
    } else {
      // Google no devolvió nextSyncToken: la próxima vuelta relee la ventana.
      // No es un error, pero conviene verlo en cron_runs.
      resumen.sinSyncToken = true
    }
  } catch (e) {
    const error = e as { code?: string; message?: string }
    resumen.error = esErrorDeMigracion(error) ? FALTA_MIGRACION : error.message ?? String(e)
  }

  return resumen
}

/**
 * Sincroniza todos los clientes que tengan calendario configurado.
 *
 * Un cliente que falla no detiene a los demás: cada uno devuelve su propio
 * resumen con su propio error. Un calendario mal compartido no puede dejar sin
 * agendas al resto.
 */
export async function sincronizarAgendas(): Promise<{
  ok: boolean
  motivo?: string
  resultados: ResumenSync[]
}> {
  if (!credencialesConfiguradas()) {
    return {
      ok: false,
      motivo: 'Faltan GOOGLE_SA_EMAIL o GOOGLE_SA_PRIVATE_KEY',
      resultados: [],
    }
  }

  const supabase = createAdminClient()

  const conNotetaker = await supabase
    .from('clients')
    .select('id, name, google_calendar_id, google_calendar_sync_token, notetaker_email')
    .not('google_calendar_id', 'is', null)

  let notetakerDisponible = true
  let clientes: FilaCliente[]

  if (esErrorDeMigracion(conNotetaker.error)) {
    // La 051 agrega notetaker_email. Si todavía no se corrió, se sigue trayendo
    // agendas sin esa parte: el módulo ya está en producción y no puede dejar
    // de funcionar esperando una migración.
    notetakerDisponible = false
    const sinNotetaker = await supabase
      .from('clients')
      .select('id, name, google_calendar_id, google_calendar_sync_token')
      .not('google_calendar_id', 'is', null)

    if (sinNotetaker.error) {
      return {
        ok: false,
        motivo: esErrorDeMigracion(sinNotetaker.error) ? FALTA_MIGRACION : sinNotetaker.error.message,
        resultados: [],
      }
    }
    clientes = (sinNotetaker.data ?? []).map((c) => ({ ...c, notetaker_email: null }))
  } else if (conNotetaker.error) {
    return { ok: false, motivo: conNotetaker.error.message, resultados: [] }
  } else {
    clientes = conNotetaker.data ?? []
  }

  // Consultas baratas para saber que migraciones ya se corrieron. Sale mas
  // simple que intentar cada escritura y reintentar sin la columna al fallar.
  const sonda = await supabase.from('agenda_records').select('email_lead').limit(1)
  const emailDisponible = !esErrorDeMigracion(sonda.error)

  const sondaCancel = await supabase.from('agenda_records').select('cancelada_at').limit(1)
  const canceladasDisponible = !esErrorDeMigracion(sondaCancel.error)

  // Las lápidas de todos los clientes de una vez: son pocas y se reparten
  // después, en vez de una consulta por cliente.
  const ignoradosPorCliente = new Map<string, Set<string>>()
  const { data: lapidas, error: errorLapidas } = await supabase
    .from('agenda_eventos_ignorados')
    .select('client_id, google_event_id')

  // Sin la 055 la tabla no existe y no hay nada que ignorar. El sync sigue
  // igual, solo que borrar a mano vuelve a ser reversible por el sync.
  if (!errorLapidas) {
    for (const l of lapidas ?? []) {
      const set = ignoradosPorCliente.get(l.client_id as string) ?? new Set<string>()
      set.add(l.google_event_id as string)
      ignoradosPorCliente.set(l.client_id as string, set)
    }
  }

  const resultados: ResumenSync[] = []
  for (const c of clientes) {
    resultados.push(
      await sincronizarCliente(
        c.id,
        c.name ?? 'sin nombre',
        c.google_calendar_id as string,
        c.google_calendar_sync_token,
        c.notetaker_email,
        notetakerDisponible,
        emailDisponible,
        canceladasDisponible,
        ignoradosPorCliente.get(c.id) ?? new Set<string>()
      )
    )
  }

  return { ok: true, resultados }
}
