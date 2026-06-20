import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CalendlyInvitee {
  name: string
  email: string
  uri: string
}

interface CalendlyEvent {
  uri: string
  name: string
  start_time: string
  end_time: string
  status: string
  location?: {
    type: string
    join_url?: string
    location?: string
  }
  calendar_event?: {
    external_id: string
    kind: string
  }
}

interface CalendlyPayload {
  event: string
  payload: {
    event: CalendlyEvent
    invitee?: CalendlyInvitee
    cancel_url?: string
    reschedule_url?: string
  }
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

    const eventData = body.payload?.event
    const invitee = body.payload?.invitee

    if (!eventData || !invitee) {
      await markLog(supabase, webhookLogId, true, 'No event or invitee data')
      return NextResponse.json({ received: true, skipped: 'no_data' })
    }

    const inviteeName = invitee.name?.trim() || null
    const inviteeEmail = invitee.email?.trim().toLowerCase() || null
    const scheduledAt = eventData.start_time
    const endTime = eventData.end_time
    const meetingUrl = eventData.location?.join_url || null
    const eventName = eventData.name || null
    const calendlyEventUri = eventData.uri

    // ── Handle cancellations ──
    if (body.event === 'invitee.canceled') {
      const { data: existingCall } = await supabase
        .from('sales_calls')
        .select('id')
        .eq('fathom_recording_id', calendlyEventUri)
        .maybeSingle()

      if (existingCall) {
        await supabase
          .from('sales_calls')
          .update({ outcome: 'cancelled' })
          .eq('id', existingCall.id)
      }

      await markLog(supabase, webhookLogId, true)
      return NextResponse.json({ received: true, action: 'cancelled' })
    }

    // ── Find matching lead ──
    let leadId: string | null = null
    let clientId: string | null = null

    if (inviteeEmail) {
      const { data: leadByEmail } = await supabase
        .from('leads')
        .select('id, client_id')
        .ilike('email', inviteeEmail)
        .limit(1)
        .maybeSingle()

      if (leadByEmail) {
        leadId = leadByEmail.id
        clientId = leadByEmail.client_id
      }
    }

    if (!leadId && inviteeName) {
      const { data: leadByName } = await supabase
        .from('leads')
        .select('id, client_id')
        .ilike('full_name', `%${inviteeName}%`)
        .limit(1)
        .maybeSingle()

      if (leadByName) {
        leadId = leadByName.id
        clientId = leadByName.client_id
      }
    }

    if (!leadId) {
      // No matching lead — log for manual review but still create the call
      console.log(`[Calendly] No lead match for: ${inviteeName} (${inviteeEmail})`)
    }

    // ── Update lead stage to agenda_set ──
    if (leadId) {
      await supabase
        .from('leads')
        .update({
          stage: 'agenda_set',
          agenda_at: scheduledAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leadId)
        .in('stage', ['new', 'contacted'])
    }

    // ── Create sales_calls record ──
    const durationSeconds = scheduledAt && endTime
      ? Math.round((new Date(endTime).getTime() - new Date(scheduledAt).getTime()) / 1000)
      : null

    const { data: existingCall } = await supabase
      .from('sales_calls')
      .select('id')
      .eq('fathom_recording_id', calendlyEventUri)
      .maybeSingle()

    if (existingCall) {
      await supabase
        .from('sales_calls')
        .update({
          scheduled_at: scheduledAt,
          duration_seconds: durationSeconds,
          fathom_call_url: meetingUrl,
          ai_summary: eventName ? `Calendly: ${eventName}` : null,
        })
        .eq('id', existingCall.id)
    } else {
      await supabase.from('sales_calls').insert({
        lead_id: leadId,
        scheduled_at: scheduledAt,
        duration_seconds: durationSeconds,
        outcome: null,
        fathom_recording_id: calendlyEventUri,
        fathom_call_url: meetingUrl,
        ai_summary: [
          eventName ? `Calendly: ${eventName}` : null,
          inviteeName ? `Invitado: ${inviteeName}` : null,
          inviteeEmail ? `Email: ${inviteeEmail}` : null,
        ].filter(Boolean).join(' · '),
        next_steps: meetingUrl ? `Google Meet: ${meetingUrl}` : null,
      })
    }

    await markLog(supabase, webhookLogId, true)

    return NextResponse.json({
      received: true,
      lead_id: leadId,
      client_id: clientId,
      scheduled_at: scheduledAt,
      meeting_url: meetingUrl,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
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
