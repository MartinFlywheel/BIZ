import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Meta Cloud API webhook verification handshake (GET) — required once when
// registering the callback URL in the Meta App dashboard.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

const digitsOnly = (s: string) => s.replace(/\D/g, '')

export async function POST(req: Request) {
  const supabase = createAdminClient()

  try {
    const body = await req.json()

    await supabase.from('webhook_logs').insert({
      source: 'whatsapp',
      event_type: 'incoming_message',
      payload: body,
      processed: false,
    })

    const messages = body?.entry?.flatMap((entry: any) =>
      entry.changes?.flatMap((change: any) => change.value?.messages || []) || []
    ) || []

    for (const message of messages) {
      await handleIncomingMessage(supabase, message)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[WhatsApp] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleIncomingMessage(supabase: ReturnType<typeof createAdminClient>, message: any) {
  const from = digitsOnly(message.from || '')
  if (!from) return

  const { data: students } = await supabase
    .from('program_students')
    .select('id, phone')

  const student = students?.find((s: any) => digitsOnly(s.phone) === from)
  if (!student) {
    console.log(`[WhatsApp] No student matched for phone ${message.from}`)
    return
  }

  let messageText: string | null = null
  let audioUrl: string | null = null

  if (message.type === 'text') {
    messageText = message.text?.body || null
  } else if (message.type === 'audio' && message.audio?.id) {
    audioUrl = await downloadAndStoreMedia(supabase, message.audio.id, student.id)
  } else if (message.type === 'image') {
    messageText = '[Imagen recibida]'
  } else {
    messageText = `[Mensaje de tipo ${message.type} no soportado]`
  }

  await supabase.from('student_messages').insert({
    student_id: student.id,
    sender: 'client',
    message_text: messageText,
    audio_url: audioUrl,
    wa_message_id: message.id || null,
  })
}

async function downloadAndStoreMedia(
  supabase: ReturnType<typeof createAdminClient>,
  mediaId: string,
  studentId: string
): Promise<string | null> {
  const token = process.env.META_WHATSAPP_TOKEN
  if (!token) return null

  try {
    const metaResponse = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!metaResponse.ok) return null
    const { url: mediaUrl } = await metaResponse.json()

    const fileResponse = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!fileResponse.ok) return null
    const buffer = await fileResponse.arrayBuffer()

    const path = `${studentId}/inbound-${Date.now()}.ogg`
    const { error: uploadError } = await supabase.storage
      .from('product-audio')
      .upload(path, buffer, { contentType: 'audio/ogg', upsert: false })
    if (uploadError) return null

    return supabase.storage.from('product-audio').getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('[WhatsApp] Media download failed:', err)
    return null
  }
}
