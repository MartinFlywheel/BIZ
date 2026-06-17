import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Webhooks must never be cached and must run on the Node.js runtime
// (needs access to Supabase service-role client at request time).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN

interface WebhookEntry {
  id: string
  time: number
  messaging?: Array<{
    sender: { id: string }
    recipient: { id: string }
    timestamp: number
    message?: { mid: string; text: string }
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

// GET — Meta webhook verification (subscription handshake)
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    console.log('[Meta Webhook] Verification successful')
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  )
}

// POST — Receive webhook events (messages, comments, etc.)
export async function POST(request: NextRequest) {
  // Respond immediately with 200 to avoid Meta blocking the webhook
  const responsePromise = NextResponse.json({ received: true }, { status: 200 })

  try {
    const payload: WebhookPayload = await request.json()

    const supabase = createAdminClient()

    await supabase.from('webhook_logs').insert({
      source: 'meta',
      event_type: payload.object,
      payload: payload as unknown as Record<string, unknown>,
    })

    for (const entry of payload.entry) {
      // Process messaging events (Instagram DMs)
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.message) {
            console.log(
              '[Meta Webhook] Message from',
              event.sender.id,
              ':',
              event.message.text
            )

            await supabase.from('webhook_logs').insert({
              source: 'meta',
              event_type: 'message',
              payload: event as unknown as Record<string, unknown>,
              processed: false,
            })
          }
        }
      }

      // Process field changes (comments, mentions, etc.)
      if (entry.changes) {
        for (const change of entry.changes) {
          console.log('[Meta Webhook] Change on field:', change.field)

          await supabase.from('webhook_logs').insert({
            source: 'meta',
            event_type: `change:${change.field}`,
            payload: change.value as Record<string, unknown>,
            processed: false,
          })
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Meta Webhook] Processing error:', message)
  }

  return responsePromise
}
