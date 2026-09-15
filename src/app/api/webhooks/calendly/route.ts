import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isoChileDe } from '@/lib/fecha-chile'
import { buscarAgendaManualEquivalente, moverLeadAAgendado } from '@/lib/services/agenda-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Webhook de Calendly (planes pagados). Hoy está dormido: ningún cliente tiene
// calendly_org_uri y las reservas llegan por Google Calendar (agenda-sync).
//
// Dos cosas que hacía mal y ya no:
// - Guardaba la URI del evento de Calendly en agenda_records.link_reporte y
//   cancelaba y deduplicaba buscando por ese valor. link_reporte es el enlace
//   de la grabación: en cuanto el sync de Fathom lo sobrescribía, la
//   cancelación dejaba de encontrar la agenda. Ahora se usa calendly_uuid, la
//   misma columna que llena el sync del calendario.
// - Creaba una fila en sales_calls con la URI de Calendly metida en
//   fathom_recording_id. Las llamadas viven en agenda_records; sales_calls
//   quedó como legado de solo lectura.

interface CalendlyInvitee {
  name?: string
  email?: string
  uri?: string
  cancel_url?: string
}

interface CalendlyEvent {
  uri: string
  name?: string
  start_time: string
  end_time?: string
  status?: string
  location?: {
    type?: string
    join_url?: string
    location?: string
  }
}

interface CalendlyPayload {
  event: string
  payload: {
    // v1 trae el evento y el invitado por separado; v2 manda el invitado como
    // payload y el evento en scheduled_event.
    event?: CalendlyEvent
    scheduled_event?: CalendlyEvent
    invitee?: CalendlyInvitee
    name?: string
    email?: string
    uri?: string
    cancel_url?: string
  }
}

/**
 * Los UUID con los que puede estar guardada la reserva.
 *
 * El sync del calendario guarda el del invitado (sale del enlace de
 * cancelación "calendly.com/cancellations/<uuid>"); el evento tiene otro. Se
 * prueban los dos para que una reserva que entró por el calendario y luego
 * llega por webhook no se duplique.
 */
function uuidsDeReserva(evento: CalendlyEvent, invitado: CalendlyInvitee): string[] {
  const deInvitado =
    invitado.cancel_url?.match(/cancellations\/([\w-]+)/i)?.[1] ??
    invitado.uri?.match(/invitees\/([\w-]+)/i)?.[1] ??
    null
  const deEvento = evento.uri?.match(/scheduled_events\/([\w-]+)/i)?.[1] ?? null
  return [deInvitado, deEvento].filter((u): u is string => !!u)
}

export async function POST(request: Request) {
  const supabase = createAdminClient()
  let webhookLogId: string | null = null

  try {
    const body: CalendlyPayload = await request.json()

    const { data: logRow } = await supabase
      .from('webhook_logs')
      .insert({
        source: 'calendly',
        event_type: body.event,
        payload: body as unknown as Record<string, unknown>,
        processed: false,
      })
      .select('id')
      .single()

    webhookLogId = logRow?.id || null

    const eventData = body.payload?.event ?? body.payload?.scheduled_event
    const invitee: CalendlyInvitee | undefined = body.payload?.invitee ?? (body.payload?.email
      ? { name: body.payload.name, email: body.payload.email, uri: body.payload.uri, cancel_url: body.payload.cancel_url }
      : undefined)

    if (!eventData || !invitee) {
      await markLog(supabase, webhookLogId, true, 'Sin datos de evento o invitado')
      return NextResponse.json({ received: true, skipped: 'no_data' })
    }

    const inviteeName = invitee.name?.trim() || null
    const inviteeEmail = invitee.email?.trim().toLowerCase() || null
    const scheduledAt = eventData.start_time
    const meetingUrl = eventData.location?.join_url || null
    const calendlyEventUri = eventData.uri
    const uuids = uuidsDeReserva(eventData, invitee)

    // ── Cancelaciones ──
    if (body.event === 'invitee.canceled') {
      if (uuids.length > 0) {
        // Cancelar no es no-show: marcarla así bajaba el show rate, que es
        // justo lo que la migración 055 quiso evitar. Se anota la
        // cancelación y el estado queda como estaba.
        await supabase
          .from('agenda_records')
          .update({ cancelada_at: new Date().toISOString() })
          .in('calendly_uuid', uuids)
          .is('cancelada_at', null)
      }
      await markLog(supabase, webhookLogId, true, uuids.length === 0 ? 'Cancelación sin UUID de Calendly' : undefined)
      return NextResponse.json({ received: true, action: 'cancelled' })
    }

    // ── Cliente por la URI de la organización de Calendly ──
    let clientId: string | null = null

    const { data: clientsWithCalendly } = await supabase
      .from('clients')
      .select('id, calendly_org_uri')
      .not('calendly_org_uri', 'is', null)

    if (clientsWithCalendly && clientsWithCalendly.length > 0) {
      const eventUri = calendlyEventUri || ''
      for (const c of clientsWithCalendly) {
        if (c.calendly_org_uri && eventUri.includes(c.calendly_org_uri.split('/organizations/')[1] || '___none___')) {
          clientId = c.id
          break
        }
      }
      // Solo se adivina si hay exactamente un cliente con Calendly conectado:
      // con dos o más, una URI que no coincide no puede atribuirse a uno
      // cualquiera (mezclaría los datos de dos clientes).
      if (!clientId && clientsWithCalendly.length === 1) {
        clientId = clientsWithCalendly[0].id
      }
    }

    if (!clientId) {
      await markLog(supabase, webhookLogId, true, `Ningún cliente coincide con la organización de Calendly del evento ${calendlyEventUri || 'desconocido'}`)
      return NextResponse.json({
        received: true,
        warning: 'Ningún cliente coincide: queda registrado para revisarlo a mano',
      })
    }

    // ── Lead ──
    let leadId: string | null = null

    if (inviteeEmail) {
      const { data: leadByEmail } = await supabase
        .from('leads')
        .select('id')
        .eq('client_id', clientId)
        .ilike('email', inviteeEmail)
        .limit(1)
        .maybeSingle()
      if (leadByEmail) leadId = leadByEmail.id
    }

    if (!leadId && inviteeName && inviteeName.length >= 4) {
      const { data: leadsByName } = await supabase
        .from('leads')
        .select('id')
        .eq('client_id', clientId)
        .ilike('full_name', `%${inviteeName}%`)
        .limit(2)
      // Dos leads con el mismo nombre: no se adivina. Lo resuelve el setter.
      if (leadsByName && leadsByName.length === 1) leadId = leadsByName[0].id
    }

    if (leadId) await moverLeadAAgendado(supabase, clientId, leadId, scheduledAt)

    // ── Agenda: se deduplica por calendly_uuid ──
    // La fecha en hora de Chile: start_time viene en UTC y un split('T') corría
    // las llamadas de la noche al día siguiente.
    const fechaAgenda = scheduledAt ? isoChileDe(scheduledAt) : null

    const { data: existentes } = uuids.length > 0
      ? await supabase
          .from('agenda_records')
          .select('id')
          .eq('client_id', clientId)
          .in('calendly_uuid', uuids)
          .limit(1)
      : { data: [] as { id: string }[] }
    const existingAgenda = existentes?.[0] ?? null

    let agendaId: string | null = null

    if (existingAgenda) {
      agendaId = existingAgenda.id
      await supabase
        .from('agenda_records')
        .update({ hora_agenda: scheduledAt, fecha_agenda: fechaAgenda, link_reunion: meetingUrl })
        .eq('id', existingAgenda.id)
    } else {
      const manual = await buscarAgendaManualEquivalente(supabase, clientId, {
        fecha: fechaAgenda,
        leadId,
        nombre: inviteeName,
        calendlyUuid: uuids[0] ?? null,
        canceladasDisponible: true,
      })

      if (manual) {
        agendaId = manual.id
        await supabase
          .from('agenda_records')
          .update({
            calendly_uuid: uuids[0] ?? null,
            hora_agenda: scheduledAt,
            fecha_agenda: fechaAgenda,
            ...(manual.link_reunion ? {} : { link_reunion: meetingUrl }),
            ...(manual.email_lead ? {} : { email_lead: inviteeEmail }),
            ...(manual.lead_id || !leadId ? {} : { lead_id: leadId }),
            ...(manual.nombre_lead ? {} : { nombre_lead: inviteeName }),
          })
          .eq('id', manual.id)
      } else {
        const { data: creada } = await supabase
          .from('agenda_records')
          .insert({
            client_id: clientId,
            lead_id: leadId,
            nombre_lead: inviteeName,
            email_lead: inviteeEmail,
            calendly_uuid: uuids[0] ?? null,
            hora_agenda: scheduledAt,
            fecha_agenda: fechaAgenda,
            fecha_agendado: isoChileDe(new Date()),
            link_reunion: meetingUrl,
            de_donde_vino: eventData.name ?? null,
            estado: 'Pendiente',
          })
          .select('id')
          .single()
        agendaId = creada?.id ?? null
      }
    }

    await markLog(supabase, webhookLogId, true)

    return NextResponse.json({
      received: true,
      lead_id: leadId,
      client_id: clientId,
      agenda_id: agendaId,
      scheduled_at: scheduledAt,
      meeting_url: meetingUrl,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[Calendly] Error:', msg)
    await markLog(supabase, webhookLogId, false, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markLog(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string | null,
  processed: boolean,
  error?: string
) {
  if (!logId) return
  await supabase
    .from('webhook_logs')
    .update({ processed, error: error || null })
    .eq('id', logId)
}
