import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type Classification = 'chat_abierto' | 'conversacion_real' | 'disqualified'

const VALID_CLASSIFICATIONS: Classification[] = ['chat_abierto', 'conversacion_real', 'disqualified']

// Resolves the interaction's classification from an explicit field in the
// ManyChat payload (classification / event / stage), falling back to the
// legacy tag/qualified-flag heuristic, and defaulting to "chat abrió el CTA"
// when nothing says otherwise — matches ManyChat calling this webhook once
// on flow entry and again (with an explicit marker) once the prospect replies.
export function resolveClassification(payload: Record<string, unknown>): Classification {
  const explicit = (payload.classification || payload.event || payload.stage) as string | undefined
  if (explicit && VALID_CLASSIFICATIONS.includes(explicit as Classification)) {
    return explicit as Classification
  }

  const tags = (payload.tags as string[]) || []
  const customFields = (payload.custom_fields as Record<string, unknown>) || {}
  const isQualified =
    tags.includes('qualified') ||
    tags.includes('conversacion_real') ||
    customFields.qualified === true ||
    payload.qualified === true

  return isQualified ? 'conversacion_real' : 'chat_abierto'
}

export interface InteractionParams {
  clientId: string
  contentId: string | null
  igUsername: string
  fullName: string | null
  subscriberId: string
  keywordUsed: string | null
  classification: Classification
  customFields?: Record<string, unknown>
}

// Records a ManyChat interaction. When the incoming event is anything other
// than "chat_abierto", first looks for a recent chat_abierto row from the
// same person and promotes it in place — so a two-call ManyChat flow (entry,
// then reply) produces ONE interaction that upgrades over time, instead of
// two separate rows that would double-count "chats abiertos".
export async function upsertInteraction(supabase: AdminClient, params: InteractionParams): Promise<void> {
  const now = new Date().toISOString()

  if (params.classification !== 'chat_abierto' && params.igUsername) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('interactions')
      .select('id')
      .eq('client_id', params.clientId)
      .eq('ig_username', params.igUsername)
      .eq('classification', 'chat_abierto')
      .gte('bot_triggered_at', since)
      .order('bot_triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('interactions')
        .update({
          classification: params.classification,
          prospect_responded_at: now,
          qualified_at: params.classification === 'conversacion_real' ? now : null,
          updated_at: now,
        })
        .eq('id', existing.id)
      return
    }
  }

  await supabase.from('interactions').insert({
    client_id: params.clientId,
    content_id: params.contentId,
    ig_username: params.igUsername,
    prospect_name: params.fullName,
    classification: params.classification,
    source: 'manychat',
    manychat_subscriber_id: params.subscriberId,
    keyword_used: params.keywordUsed,
    bot_triggered_at: now,
    prospect_responded_at: params.classification !== 'chat_abierto' ? now : null,
    qualified_at: params.classification === 'conversacion_real' ? now : null,
    prequalification_data: params.customFields || {},
    promoted_to_lead: true,
  })
}

// ── Shared handler for the per-piece webhook URLs ───────────────────────────
// Two ManyChat "External Request" nodes call the same logic with a different
// forced classification, so which node fires depends only on where it sits
// in the flow — no JSON body editing required on the ManyChat side:
//   /api/webhooks/manychat/{pieceId}               → chat_abierto (place at the CTA/trigger)
//   /api/webhooks/manychat/{pieceId}/conversacion   → conversacion_real (place after the reply)

export async function handlePieceWebhook(
  request: Request,
  pieceId: string,
  forcedClassification?: Classification
): Promise<NextResponse> {
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

    // Register interaction — classification is forced by which URL was
    // called, falling back to the payload/default resolution otherwise.
    const classification = forcedClassification || resolveClassification(payload)
    await upsertInteraction(supabase, {
      clientId,
      contentId,
      igUsername,
      fullName,
      subscriberId,
      keywordUsed: pieceId,
      classification,
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
      classification,
      is_new_lead: !existingLead,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
