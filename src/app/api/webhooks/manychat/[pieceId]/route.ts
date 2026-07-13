import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pieceId: string }> }
) {
  const { pieceId } = await params
  const supabase = createAdminClient()

  try {
    const payload = await request.json()

    // ManyChat Full Contact Data uses various field names depending on version
    const igUsername = (
      payload.ig_username ||
      payload.instagram_user_handle ||
      payload.username ||
      payload.instagram_username ||
      ''
    ).replace(/^@/, '').trim()

    const fullName = (
      payload.full_name ||
      payload.name ||
      (payload.first_name ? `${payload.first_name} ${payload.last_name || ''}`.trim() : '') ||
      ''
    ).trim() || null

    const email = payload.email || null
    const phone = payload.phone || payload.phone_number || null

    const subscriberId = (
      payload.subscriber_id ||
      payload.id ||
      ''
    ).toString()

    if (!igUsername && !subscriberId) {
      return NextResponse.json({ error: 'Missing identifier' }, { status: 400 })
    }

    // Match content piece by keyword_trigger = pieceId
    const { data: contentMatch } = await supabase
      .from('content_pieces')
      .select('id, client_id')
      .ilike('keyword_trigger', pieceId)
      .limit(1)
      .maybeSingle()

    const contentId = contentMatch?.id || null
    const clientId = contentMatch?.client_id || null

    if (!clientId) {
      await supabase.from('webhook_logs').insert({
        source: 'manychat',
        event_type: `piece:${pieceId}`,
        payload: { ...payload, pieceId },
        processed: false,
        error: `No content piece matched keyword_trigger="${pieceId}"`,
      })
      return NextResponse.json({
        received: true,
        warning: `No content piece with keyword_trigger="${pieceId}"`,
      })
    }

    // Log
    await supabase.from('webhook_logs').insert({
      source: 'manychat',
      event_type: `piece:${pieceId}`,
      payload: { ...payload, pieceId },
      processed: false,
    })

    // Upsert lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, first_touch_content_id')
      .eq('client_id', clientId)
      .eq('ig_username', igUsername)
      .maybeSingle()

    let leadId: string

    if (existingLead) {
      leadId = existingLead.id
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (fullName) updates.full_name = fullName
      if (contentId && existingLead.first_touch_content_id && existingLead.first_touch_content_id !== contentId) {
        updates.conversion_touch_content_id = contentId
        updates.conversion_touch_at = new Date().toISOString()
        updates.conversion_touch_type = 'manychat_piece'
      }
      await supabase.from('leads').update(updates).eq('id', leadId)
    } else {
      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          client_id: clientId,
          ig_username: igUsername || null,
          full_name: fullName,
          email,
          phone,
          stage: 'nuevo_contacto',
          source: 'manychat_keyword',
          first_touch_content_id: contentId,
          first_touch_at: new Date().toISOString(),
          first_touch_type: `manychat:${pieceId}`,
        })
        .select('id')
        .single()

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
      leadId = newLead.id
    }

    // Register interaction
    await supabase.from('interactions').insert({
      client_id: clientId,
      content_id: contentId,
      ig_username: igUsername,
      prospect_name: fullName,
      classification: 'chat_abierto',
      source: 'manychat',
      manychat_subscriber_id: subscriberId,
      keyword_used: pieceId,
      bot_triggered_at: new Date().toISOString(),
      promoted_to_lead: true,
    })

    // Increment chats on content_metrics
    if (contentId) {
      const { data: metric } = await supabase
        .from('content_metrics')
        .select('id, chats_nuevos')
        .eq('content_id', contentId)
        .maybeSingle()

      if (metric) {
        await supabase
          .from('content_metrics')
          .update({
            chats_nuevos: (metric.chats_nuevos || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', metric.id)
      } else {
        await supabase.from('content_metrics').insert({
          content_id: contentId,
          client_id: clientId,
          chats_nuevos: 1,
        })
      }
    }

    // Mark log processed
    await supabase
      .from('webhook_logs')
      .update({ processed: true })
      .eq('source', 'manychat')
      .eq('event_type', `piece:${pieceId}`)
      .order('received_at', { ascending: false })
      .limit(1)

    return NextResponse.json({
      received: true,
      piece_id: pieceId,
      content_id: contentId,
      client_id: clientId,
      lead_id: leadId,
      is_new_lead: !existingLead,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
