import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveClassification, upsertInteraction } from '@/lib/manychat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = createAdminClient()
  let webhookLogId: string | null = null

  try {
    const payload = await request.json()

    // ── Step 1: Log raw payload ──────────────────────────────────
    const { data: logRow, error: logError } = await supabase
      .from('webhook_logs')
      .insert({
        source: 'manychat',
        event_type: 'incoming_message',
        payload,
        processed: false,
      })
      .select('id')
      .single()

    if (logError) {
      console.error('[ManyChat] Log insert error:', logError.message)
    }
    webhookLogId = logRow?.id || null

    // ── Step 2: Extract data ─────────────────────────────────────
    const igUsername = (
      payload.ig_username ||
      payload.username ||
      payload.custom_fields?.ig_username ||
      ''
    ).replace(/^@/, '').trim()

    const fullName = (
      payload.full_name ||
      payload.name ||
      payload.custom_fields?.full_name ||
      ''
    ).trim() || null

    const subscriberId = (
      payload.subscriber_id ||
      payload.manychat_subscriber_id ||
      payload.id ||
      ''
    ).toString()

    const payloadId = (
      payload.payload_id ||
      payload.keyword ||
      payload.custom_fields?.payload_id ||
      payload.custom_fields?.keyword ||
      payload.custom_fields?.content_id ||
      ''
    ).trim()

    const phone = payload.phone || payload.custom_fields?.phone || null
    const email = payload.email || payload.custom_fields?.email || null
    const customFields = payload.custom_fields || {}

    if (!igUsername && !subscriberId) {
      await markLogError(supabase, webhookLogId, 'Missing ig_username and subscriber_id')
      return NextResponse.json({ error: 'Missing identifier' }, { status: 400 })
    }

    // ── Step 3: Content attribution ──────────────────────────────
    // Match payload_id against content_pieces.keyword_trigger
    let contentId: string | null = null
    let clientId: string | null = null

    if (payloadId) {
      const { data: contentMatch } = await supabase
        .from('content_pieces')
        .select('id, client_id')
        .ilike('keyword_trigger', payloadId)
        .limit(1)
        .maybeSingle()

      if (contentMatch) {
        contentId = contentMatch.id
        clientId = contentMatch.client_id
      }
    }

    // Fallback: try client_id from payload directly
    if (!clientId) {
      clientId = payload.client_id || customFields.client_id || null
    }

    // If still no client, try matching by IG account
    if (!clientId && igUsername) {
      const { data: clientMatch } = await supabase
        .from('clients')
        .select('id')
        .ilike('ig_handle', `%${igUsername.split('.')[0]}%`)
        .limit(1)
        .maybeSingle()

      if (clientMatch) clientId = clientMatch.id
    }

    if (!clientId) {
      await markLogError(supabase, webhookLogId, `No client matched for payload_id="${payloadId}" username="${igUsername}"`)
      return NextResponse.json({
        received: true,
        warning: 'No client matched — logged for manual review',
      })
    }

    // ── Step 4: Upsert lead ──────────────────────────────────────
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, stage, first_touch_content_id')
      .eq('client_id', clientId)
      .eq('ig_username', igUsername)
      .maybeSingle()

    let leadId: string

    if (existingLead) {
      leadId = existingLead.id

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      // If lead already has a first touch but gets a new content trigger,
      // record it as conversion touch
      if (contentId && existingLead.first_touch_content_id && existingLead.first_touch_content_id !== contentId) {
        updates.conversion_touch_content_id = contentId
        updates.conversion_touch_at = new Date().toISOString()
        updates.conversion_touch_type = 'manychat_keyword'
      }

      if (fullName) updates.full_name = fullName
      if (phone) updates.phone = phone
      if (email) updates.email = email

      const { error: updateError } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', leadId)

      if (updateError) {
        console.error('[ManyChat] Lead update error:', updateError.message)
      }
    } else {
      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          client_id: clientId,
          ig_username: igUsername,
          full_name: fullName,
          phone,
          email,
          stage: 'new',
          first_touch_content_id: contentId,
          first_touch_at: new Date().toISOString(),
          first_touch_type: payloadId ? 'manychat_keyword' : 'manychat_direct',
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('[ManyChat] Lead insert error:', insertError.message)
        await markLogError(supabase, webhookLogId, `Lead insert failed: ${insertError.message}`)
        return NextResponse.json({ error: 'Lead creation failed' }, { status: 500 })
      }

      leadId = newLead.id
    }

    // ── Step 5: Register interaction ─────────────────────────────
    const classification = resolveClassification(payload)

    try {
      await upsertInteraction(supabase, {
        clientId,
        contentId,
        igUsername,
        fullName,
        subscriberId,
        keywordUsed: payloadId || null,
        classification,
        customFields,
      })
    } catch (err) {
      console.error('[ManyChat] Interaction upsert error:', err)
    }

    // ── Step 6: Update content_metrics chats count ────────────────
    if (contentId) {
      const { data: existingMetric } = await supabase
        .from('content_metrics')
        .select('id, chats_nuevos')
        .eq('content_id', contentId)
        .maybeSingle()

      if (existingMetric) {
        await supabase
          .from('content_metrics')
          .update({
            chats_nuevos: (existingMetric.chats_nuevos || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingMetric.id)
      } else {
        await supabase.from('content_metrics').insert({
          content_id: contentId,
          client_id: clientId,
          chats_nuevos: 1,
        })
      }
    }

    // ── Step 7: Mark webhook log as processed ────────────────────
    if (webhookLogId) {
      await supabase
        .from('webhook_logs')
        .update({ processed: true })
        .eq('id', webhookLogId)
    }

    return NextResponse.json({
      received: true,
      lead_id: leadId,
      content_id: contentId,
      client_id: clientId,
      classification,
      is_new_lead: !existingLead,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[ManyChat] Fatal error:', msg)
    await markLogError(supabase, webhookLogId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markLogError(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string | null,
  errorMsg: string
) {
  if (!logId) return
  await supabase
    .from('webhook_logs')
    .update({ error: errorMsg })
    .eq('id', logId)
}
