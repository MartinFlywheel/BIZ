import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: unprocessed, error: fetchError } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('source', 'meta')
    .eq('processed', false)
    .order('received_at', { ascending: true })
    .limit(50)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!unprocessed || unprocessed.length === 0) {
    return NextResponse.json({ status: 'nothing_to_process' })
  }

  let processed = 0
  let errors = 0

  for (const log of unprocessed) {
    try {
      const payload = log.payload as {
        object?: string
        entry?: Array<{
          id: string
          time: number
          messaging?: Array<{
            sender: { id: string }
            recipient: { id: string }
            timestamp: number
            message?: {
              mid: string
              text?: string
              is_echo?: boolean
              attachments?: Array<{ type: string; payload: { url: string } }>
              reply_to?: { mid: string }
            }
          }>
        }>
      }

      if (!payload.entry) {
        await supabase
          .from('webhook_logs')
          .update({ processed: true, error: 'No entry array in payload' })
          .eq('id', log.id)
        continue
      }

      for (const entry of payload.entry) {
        if (!entry.messaging) continue

        for (const event of entry.messaging) {
          if (event.message?.is_echo) continue
          if (!event.message) continue

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

          await supabase
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
              webhook_log_id: log.id,
              received_at: new Date(event.timestamp * 1000).toISOString(),
            }, {
              onConflict: 'message_mid',
              ignoreDuplicates: true,
            })
        }
      }

      await supabase
        .from('webhook_logs')
        .update({ processed: true })
        .eq('id', log.id)

      processed++
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown'
      await supabase
        .from('webhook_logs')
        .update({ error: msg })
        .eq('id', log.id)
      errors++
    }
  }

  return NextResponse.json({ processed, errors, total: unprocessed.length })
}
