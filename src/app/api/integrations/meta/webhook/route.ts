import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// .env.example ships META_APP_SECRET as a scaffolded placeholder — treat
// that (or an unset var) as "not really configured yet" so enforcing
// verification below can't accidentally reject every real Meta event with
// a secret nobody actually set. Swap in the real App Secret (Meta App
// Dashboard → Settings → Basic) and this starts enforcing automatically,
// no second code change needed.
function isRealAppSecret(value: string | undefined): value is string {
  if (!value) return false
  const lower = value.toLowerCase()
  return !lower.includes('your_') && !lower.includes('_here')
}

function hasValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(provided, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

type AdminClient = ReturnType<typeof createAdminClient>

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
  const rawBody = await request.text()
  const appSecret = process.env.META_APP_SECRET

  if (isRealAppSecret(appSecret)) {
    // Log-only for now, deliberately not rejecting yet: this deploys
    // against a live Vercel Secret whose actual value can't be read back
    // to confirm it's really the Meta App Secret (vs. something stale or
    // set for another purpose). Flip this to `return 401` once the logs
    // below show real inbound traffic consistently matching — rejecting
    // on an unverified secret risks silently dropping every real DM.
    const signature = request.headers.get('x-hub-signature-256')
    if (!hasValidSignature(rawBody, signature, appSecret)) {
      console.error('[Meta Webhook] Signature check FAILED (not enforced yet) — verify META_APP_SECRET is the real Meta App Secret before flipping this to reject.')
    } else {
      console.log('[Meta Webhook] Signature check passed.')
    }
  } else {
    console.warn('[Meta Webhook] META_APP_SECRET not configured — skipping signature verification. Anyone who finds this URL can inject fake events until it is set.')
  }

  try {
    const payload: WebhookPayload = JSON.parse(rawBody)
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
          if (!event.message) continue

          // Echoes are messages the page itself sent (ManyChat's bot
          // replies, or a setter's own manual send bouncing back) — the
          // sender/recipient are reversed vs. a normal inbound message.
          const isOutbound = !!event.message.is_echo
          const igAccountId = isOutbound ? event.sender.id : event.recipient.id
          const otherPartyId = isOutbound ? event.recipient.id : event.sender.id

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
            .eq('ig_account_id', igAccountId)
            .maybeSingle()

          const leadId = client ? await resolveLeadId(supabase, client.id, otherPartyId) : null

          const { error: msgError } = await supabase
            .from('incoming_messages')
            .upsert({
              sender_ig_id: event.sender.id,
              recipient_ig_id: event.recipient.id,
              message_text: messageText,
              message_mid: event.message.mid,
              media_url: mediaUrl,
              message_type: messageType,
              status: isOutbound ? 'read' : 'unread',
              client_id: client?.id || null,
              lead_id: leadId,
              direction: isOutbound ? 'outbound' : 'inbound',
              webhook_log_id: webhookLogId,
              received_at: new Date(event.timestamp).toISOString(),
            }, {
              onConflict: 'message_mid',
              ignoreDuplicates: true,
            })

          if (msgError) {
            console.error('[Meta Webhook] Message insert error:', msgError.message)
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

// Matches a lead's Instagram-scoped id (IGSID) to a CRM lead so the chat
// thread (/clients/[id]/chat/[leadId]) can find it. The webhook payload
// only ever carries the numeric IGSID, not a username, so: reuse whatever
// a prior message already resolved for this IGSID before spending a Graph
// API call resolving it fresh.
async function resolveLeadId(supabase: AdminClient, clientId: string, igsid: string): Promise<string | null> {
  const { data: known } = await supabase
    .from('incoming_messages')
    .select('lead_id')
    .eq('client_id', clientId)
    .or(`sender_ig_id.eq.${igsid},recipient_ig_id.eq.${igsid}`)
    .not('lead_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (known?.lead_id) return known.lead_id

  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) return null

  try {
    const res = await fetch(`https://graph.facebook.com/${igsid}?fields=username&access_token=${token}`)
    if (!res.ok) return null
    const { username } = await res.json()
    if (!username) return null

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .ilike('ig_username', username)
      .limit(1)
      .maybeSingle()

    return lead?.id || null
  } catch (err) {
    console.error('[Meta Webhook] IGSID resolve failed:', err)
    return null
  }
}
