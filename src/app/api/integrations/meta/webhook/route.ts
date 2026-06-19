import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface WebhookEntry {
  id: string
  time: number
  messaging?: Array<{
    sender: { id: string }
    recipient: { id: string }
    timestamp: number
    message?: {
      mid: string
      text?: string
      attachments?: Array<{ type: string; payload: { url: string } }>
      reply_to?: { mid: string }
      is_echo?: boolean
    }
  }>
  changes?: Array<{
    field: string
    value: Record<string, unknown>
  }>
}

interface WebhookPayload {
  object: string
  entry: WebhookEntry[]
}

export async function GET(request: NextRequest) {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  const { searchParams } = request.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    console.log('[Meta Webhook] Verification successful')
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const payload: WebhookPayload = await request.json()
    const supabase = createAdminClient()

    const { data: logRow, error: logError } = await supabase
      .from('webhook_logs')
      .insert({
        source: 'meta',
        event_type: payload.object || 'unknown',
        payload: payload as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (logError) {
      console.error('[Meta Webhook] Log insert error:', logError.message)
    }

    const webhookLogId = logRow?.id || null

    for (const entry of payload.entry || []) {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.message?.is_echo) continue

          if (event.message) {
            const messageText = event.message.text || null
            const mediaUrl = event.message.attachments?.[0]?.payload?.url || null
            const isStoryReply = !!event.message.reply_to
            const messageType = mediaUrl ? 'media'
              : isStoryReply ? 'story_reply'
              : messageText ? 'text'
              : 'other'

            const { data: client } = await supabase
              .from('clients')
              .select('id')
              .eq('ig_account_id', event.recipient.id)
              .maybeSingle()

            const { error: msgError } = await supabase
              .from('incoming_messages')
              .upsert({
                sender_ig_id: event.sender.id,
                recipient_ig_id: event.recipient.id,
                message_text: messageText,
                message_mid: event.message.mid,
                media_url: mediaUrl,
                message_type: messageType,
                status: 'unread',
                client_id: client?.id || null,
                webhook_log_id: webhookLogId,
                received_at: new Date(event.timestamp * 1000).toISOString(),
              }, {
                onConflict: 'message_mid',
                ignoreDuplicates: true,
              })

            if (msgError) {
              console.error('[Meta Webhook] Message insert error:', msgError.message)
            }
          }
        }
      }

      if (entry.changes) {
        for (const change of entry.changes) {
          const { error } = await supabase.from('webhook_logs').insert({
            source: 'meta',
            event_type: `change:${change.field}`,
            payload: change.value as Record<string, unknown>,
            processed: false,
          })
          if (error) console.error('[Meta Webhook] Change insert error:', error.message)
        }
      }
    }

    // Mark the webhook log as processed
    if (webhookLogId) {
      await supabase
        .from('webhook_logs')
        .update({ processed: true })
        .eq('id', webhookLogId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Meta Webhook] Processing error:', message)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
