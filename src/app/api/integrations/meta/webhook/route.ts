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

    const { error: logError } = await supabase.from('webhook_logs').insert({
      source: 'meta',
      event_type: payload.object || 'unknown',
      payload: payload as unknown as Record<string, unknown>,
    })

    if (logError) {
      console.error('[Meta Webhook] Supabase insert error:', logError.message, logError.code, logError.details)
    }

    for (const entry of payload.entry || []) {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.message) {
            const { error } = await supabase.from('webhook_logs').insert({
              source: 'meta',
              event_type: 'message',
              payload: event as unknown as Record<string, unknown>,
              processed: false,
            })
            if (error) console.error('[Meta Webhook] Message insert error:', error.message)
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Meta Webhook] Processing error:', message)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
