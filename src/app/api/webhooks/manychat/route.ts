import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const payload = await request.json()

    await supabase.from('webhook_logs').insert({
      source: 'manychat',
      event_type: payload.event || 'unknown',
      payload,
    })

    const subscriberId = payload.subscriber_id || payload.id
    const igUsername = payload.ig_username || payload.username
    const name = payload.name || payload.full_name
    const tags = payload.tags || []
    const customFields = payload.custom_fields || {}

    if (!subscriberId) {
      return NextResponse.json({ error: 'Missing subscriber_id' }, { status: 400 })
    }

    const clientId = payload.client_id || customFields.client_id
    if (!clientId) {
      await supabase
        .from('webhook_logs')
        .update({ error: 'Missing client_id in payload or custom_fields' })
        .eq('source', 'manychat')
        .order('received_at', { ascending: false })
        .limit(1)
      return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    }

    const isQualified = tags.includes('qualified') ||
      tags.includes('conversacion_real') ||
      customFields.qualified === true ||
      customFields.responded === true

    const isDisqualified = tags.includes('disqualified') ||
      customFields.disqualified === true

    let classification: 'chat_abierto' | 'conversacion_real' | 'disqualified' = 'chat_abierto'
    if (isQualified) classification = 'conversacion_real'
    if (isDisqualified) classification = 'disqualified'

    const { data: existing } = await supabase
      .from('interactions')
      .select('id, classification')
      .eq('manychat_subscriber_id', subscriberId)
      .eq('client_id', clientId)
      .single()

    if (existing) {
      if (classification !== 'chat_abierto' && existing.classification === 'chat_abierto') {
        await supabase
          .from('interactions')
          .update({
            classification,
            prospect_responded_at: new Date().toISOString(),
            qualified_at: classification === 'conversacion_real' ? new Date().toISOString() : null,
            ig_username: igUsername || undefined,
            prospect_name: name || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      }
    } else {
      await supabase.from('interactions').insert({
        client_id: clientId,
        ig_username: igUsername,
        prospect_name: name,
        classification,
        source: 'manychat',
        manychat_subscriber_id: subscriberId,
        keyword_used: customFields.keyword || payload.keyword || null,
        bot_triggered_at: new Date().toISOString(),
        prospect_responded_at: classification !== 'chat_abierto' ? new Date().toISOString() : null,
        qualified_at: classification === 'conversacion_real' ? new Date().toISOString() : null,
        prequalification_data: customFields,
      })
    }

    await supabase
      .from('webhook_logs')
      .update({ processed: true })
      .eq('source', 'manychat')
      .order('received_at', { ascending: false })
      .limit(1)

    return NextResponse.json({ received: true, classification })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
