import { createAdminClient } from '@/lib/supabase/admin'
import { parsearEventoCalendly, type EventoCalendly } from './calendly-event'
import { listarCambios, credencialesConfiguradas, type EventoGoogle } from './google-calendar'

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
  actualizadas: number
  canceladas: number
  ignoradas: number
  /** Agendas creadas sin lead asociado: son las que el setter debe triar. */
  sinLead: number
  error: string | null
}

/** Cómo se encontró el lead. Queda guardado para poder auditar los cruces. */
type MatchMetodo = 'instagram' | 'email' | 'nombre' | null

type Supabase = ReturnType<typeof createAdminClient>

function esErrorDeMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === COLUMNA_INEXISTENTE
}

/**
 * Busca a qué lead corresponde la reserva.
 *
 * En orden de confianza: Instagram (lo escribió la persona y es único), correo
 * (exacto, pero mucha gente reserva con uno distinto al que dio antes) y nombre
 * (aproximado, el más propenso a equivocarse). El método usado queda guardado
 * para poder revisar después cuáles se cruzaron por nombre, que son las dudosas.
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
 * Un evento del calendario → una fila de agenda.
 *
 * Los eventos que no vienen de Calendly (reuniones internas, bloqueos de
 * agenda, cumpleaños) se ignoran: se reconocen porque no traen el enlace de
 * cancelación que Calendly siempre escribe en la descripción.
 */
async function procesarEvento(
  supabase: Supabase,
  clientId: string,
  evento: EventoGoogle,
  resumen: ResumenSync
): Promise<void> {
  const { data: existente, error: errorLectura } = await supabase
    .from('agenda_records')
    .select('id, lead_id, estado, comentarios')
    .eq('client_id', clientId)
    .eq('google_event_id', evento.id)
    .maybeSingle()

  if (errorLectura) throw errorLectura

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

    await supabase.from('agenda_records').update({ comentarios }).eq('id', existente.id)
    resumen.canceladas++
    return
  }

  const datos = parsearEventoCalendly(evento.description)

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
    const { error } = await supabase
      .from('agenda_records')
      .update({
        hora_agenda: inicio,
        fecha_agenda: inicio ? inicio.split('T')[0] : null,
        link_reunion: enlace,
      })
      .eq('id', existente.id)
    if (error) throw error
    resumen.actualizadas++
    return
  }

  const { leadId, metodo } = await buscarLead(supabase, clientId, datos)

  const { error } = await supabase.from('agenda_records').insert({
    client_id: clientId,
    lead_id: leadId,
    google_event_id: evento.id,
    calendly_uuid: datos.calendlyUuid,
    nombre_lead: datos.nombre,
    link_perfil: datos.instagram ? `https://instagram.com/${datos.instagram}` : null,
    hora_agenda: inicio,
    fecha_agenda: inicio ? inicio.split('T')[0] : null,
    fecha_agendado: (evento.created ?? new Date().toISOString()).split('T')[0],
    link_reunion: enlace,
    de_donde_vino: datos.tipoEvento,
    respuestas_formulario: datos.respuestas,
    match_metodo: metodo,
    estado: 'Pendiente',
  })

  if (error) throw error

  resumen.creadas++
  if (!leadId) resumen.sinLead++
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
  syncToken: string | null
): Promise<ResumenSync> {
  const supabase = createAdminClient()
  const resumen: ResumenSync = {
    cliente: nombreCliente,
    creadas: 0,
    actualizadas: 0,
    canceladas: 0,
    ignoradas: 0,
    sinLead: 0,
    error: null,
  }

  try {
    let resultado = await listarCambios(calendarId, syncToken)

    // El token caducó: se relee la ventana completa. Los eventos ya guardados
    // se reconocen por google_event_id, así que releer no duplica nada.
    if (resultado.tokenExpirado) {
      resultado = await listarCambios(calendarId, null)
    }

    for (const evento of resultado.eventos) {
      await procesarEvento(supabase, clientId, evento, resumen)
    }

    if (resultado.syncToken) {
      await supabase
        .from('clients')
        .update({
          google_calendar_sync_token: resultado.syncToken,
          google_calendar_synced_at: new Date().toISOString(),
        })
        .eq('id', clientId)
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
  const { data: clientes, error } = await supabase
    .from('clients')
    .select('id, name, google_calendar_id, google_calendar_sync_token')
    .not('google_calendar_id', 'is', null)

  if (error) {
    return {
      ok: false,
      motivo: esErrorDeMigracion(error) ? FALTA_MIGRACION : error.message,
      resultados: [],
    }
  }

  const resultados: ResumenSync[] = []
  for (const c of clientes ?? []) {
    resultados.push(
      await sincronizarCliente(
        c.id as string,
        (c.name as string) ?? 'sin nombre',
        c.google_calendar_id as string,
        (c.google_calendar_sync_token as string | null) ?? null
      )
    )
  }

  return { ok: true, resultados }
}
