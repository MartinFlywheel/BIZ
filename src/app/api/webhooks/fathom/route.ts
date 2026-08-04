import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Fathom's exact webhook payload shape hasn't been verified against a live
// event yet — every call is logged to webhook_logs regardless of parse
// outcome, so field names can be corrected here from real payloads without
// losing data. Mirrors the Calendly webhook: match a lead by invitee email
// (across all clients, since there's no per-client Fathom identifier yet),
// then upsert sales_calls keyed by the recording id.

export async function POST(request: Request) {
  const supabase = createAdminClient()
  let webhookLogId: string | null = null

  try {
    const body = await request.json()

    const { data: logRow } = await supabase
      .from('webhook_logs')
      .insert({ source: 'fathom', event_type: body?.event || 'recording', payload: body, processed: false })
      .select('id')
      .single()
    webhookLogId = logRow?.id || null

    const recordingId: string | null = body.id || body.recording_id || body.share_id || null
    const recordingUrl: string | null = body.url || body.share_url || body.recording_url || null
    const transcript: string | null = body.transcript_text || (Array.isArray(body.transcript)
      ? body.transcript.map((t: any) => t.text).filter(Boolean).join('\n')
      : null)
    const summary: string | null = body.default_summary || body.ai_summary || body.summary || null
    const startTime: string | null = body.recording_start_time || body.scheduled_start_time || null
    const endTime: string | null = body.recording_end_time || body.scheduled_end_time || null

    const invitees: Array<{ email?: string; name?: string }> =
      body.meeting_invitees || body.invitees || []

    if (!recordingId) {
      await markLog(supabase, webhookLogId, 'No recording id in payload')
      return NextResponse.json({ received: true, warning: 'No recording id — logged for manual review' })
    }

    // ── Match a lead (and its client) by invitee email ──
    let leadId: string | null = null
    let clientId: string | null = null

    for (const invitee of invitees) {
      const email = invitee.email?.trim().toLowerCase()
      if (!email) continue

      const { data: lead } = await supabase
        .from('leads')
        .select('id, client_id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle()

      if (lead) {
        leadId = lead.id
        clientId = lead.client_id
        break
      }
    }

    if (!leadId) {
      await markLog(supabase, webhookLogId, `No lead matched for invitees: ${invitees.map(i => i.email).join(', ') || 'none'}`)
      return NextResponse.json({ received: true, warning: 'No lead matched — logged for manual review' })
    }

    const durationSeconds = startTime && endTime
      ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
      : null

    const { data: existingCall } = await supabase
      .from('sales_calls')
      .select('id')
      .eq('fathom_recording_id', recordingId)
      .maybeSingle()

    if (existingCall) {
      await supabase
        .from('sales_calls')
        .update({
          scheduled_at: startTime,
          duration_seconds: durationSeconds,
          fathom_call_url: recordingUrl,
          transcript,
          ai_summary: summary,
        })
        .eq('id', existingCall.id)
    } else {
      await supabase.from('sales_calls').insert({
        lead_id: leadId,
        scheduled_at: startTime,
        duration_seconds: durationSeconds,
        fathom_recording_id: recordingId,
        fathom_call_url: recordingUrl,
        transcript,
        ai_summary: summary,
      })
    }

    await markLog(supabase, webhookLogId, null)
    return NextResponse.json({ received: true, lead_id: leadId, client_id: clientId })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Fathom] Fatal error:', msg)
    await markLog(supabase, webhookLogId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markLog(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string | null,
  error: string | null
) {
  if (!logId) return
  await supabase.from('webhook_logs').update({ processed: true, error }).eq('id', logId)
}
