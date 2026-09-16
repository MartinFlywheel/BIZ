import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esDuplicado, leadPorInstagram } from '@/lib/lead-por-instagram'
import {
  resolveClassification,
  upsertInteraction,
  pickBalancedSetter,
  incrementarChatsNuevos,
  buscarPiezaPorCodigo,
  clientePorCuentaManyChat,
  cuentaManyChat,
  errorCodigoSinPieza,
  marcarLogProcesado,
} from '@/lib/manychat'
import { exigirTokenManyChat } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const noAutorizado = exigirTokenManyChat(request)
  if (noAutorizado) return noAutorizado

  const supabase = createAdminClient()
  let webhookLogId: string | null = null
  let interaccionNueva = false

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

    // ID de Instagram del suscriptor (ig_id en ManyChat); antes no se guardaba.
    const igUserId = (payload.ig_id || payload.ig_user_id || payload.custom_fields?.ig_id || '').toString().trim() || null

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
      const contentMatch = await buscarPiezaPorCodigo(supabase, payloadId)
      if (contentMatch) {
        contentId = contentMatch.id
        clientId = contentMatch.client_id
      }
    }

    // Fallback: trust an explicit client_id if the flow sent one — leads.client_id
    // is a real FK, so a bogus value fails loudly on insert below rather than
    // silently attaching to the wrong client.
    if (!clientId) {
      clientId = payload.client_id || customFields.client_id || null
    }

    // Después, la cuenta de ManyChat del live_chat_url: identifica al cliente
    // sin adivinar (no es el usuario del prospecto, es la cuenta del negocio).
    if (!clientId) {
      clientId = await clientePorCuentaManyChat(supabase, cuentaManyChat(payload))
    }

    // El código llegó pero no tiene pieza: el chat se registra igual y el log
    // queda con la alerta para crear la pieza.
    const errorPieza = payloadId && !contentId && clientId ? errorCodigoSinPieza(payloadId) : null

    // Deliberately no further fallback here. This used to also guess the
    // client by substring-matching the *prospect's own* ig_username against
    // clients.ig_handle — those two strings have no real reason to overlap,
    // so any accidental match silently misattributed a real lead to an
    // unrelated client. Better to log it for manual review than guess wrong.
    if (!clientId) {
      await markLogError(supabase, webhookLogId, `No client matched for payload_id="${payloadId}" username="${igUsername}"`)
      return NextResponse.json({
        received: true,
        warning: 'No client matched — logged for manual review',
      })
    }

    // ── Step 4: Upsert lead ──────────────────────────────────────
    const buscarLead = async () => {
      const encontrado = await leadPorInstagram(supabase, clientId, igUsername)
      if (!encontrado) return null
      const { data } = await supabase
        .from('leads')
        .select('id, stage, first_touch_content_id, assigned_to')
        .eq('id', encontrado.id)
        .maybeSingle()
      return data
    }
    let existingLead = await buscarLead()

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
          stage: 'nuevo_contacto',
          content_id: contentId,
          first_touch_content_id: contentId,
          first_touch_at: new Date().toISOString(),
          first_touch_type: payloadId ? 'manychat_keyword' : 'manychat_direct',
        })
        .select('id')
        .single()

      // Dos llamadas del mismo contacto casi juntas: la segunda choca con el
      // índice único por Instagram (081) y usa el lead que creó la primera.
      const ganador = esDuplicado(insertError) ? await buscarLead() : null
      if (ganador) {
        existingLead = ganador
        leadId = ganador.id
      } else if (insertError || !newLead) {
        console.error('[ManyChat] Lead insert error:', insertError?.message)
        await markLogError(supabase, webhookLogId, `Lead insert failed: ${insertError?.message}`)
        return NextResponse.json({ error: 'Lead creation failed' }, { status: 500 })
      } else {
        leadId = newLead.id
      }
    }

    // ── Step 5: Register interaction ─────────────────────────────
    const classification = resolveClassification(payload)

    try {
      const { id: interactionId, nueva } = await upsertInteraction(supabase, {
        clientId,
        contentId,
        igUsername,
        fullName,
        subscriberId,
        igUserId,
        keywordUsed: payloadId || null,
        classification,
        customFields,
      })

      // This route lacked both of these — leads coming through it never
      // got linked back to their interaction (breaking the CRM's own
      // classification lookup for them) and never got auto-assigned to a
      // setter, even though the newer per-piece webhook (src/lib/manychat.ts
      // handlePieceWebhook) has done both since it was built. Same rules
      // here: conversación real or lead_calificado claims a setter,
      // load-balanced by weight, never overwriting a manual assignment.
      interaccionNueva = nueva
      await supabase.from('leads').update({ interaction_id: interactionId }).eq('id', leadId)

      if ((classification === 'conversacion_real' || classification === 'lead_calificado') && !existingLead?.assigned_to) {
        const setterId = await pickBalancedSetter(supabase, clientId)
        if (setterId) {
          await supabase.from('leads').update({ assigned_to: setterId }).eq('id', leadId).is('assigned_to', null)
        }
      }
    } catch (err) {
      console.error('[ManyChat] Interaction upsert error:', err)
    }

    // ── Step 6: Update content_metrics chats count ────────────────
    // Solo cuando la interacción es nueva: cuenta personas, no llamadas.
    if (contentId && interaccionNueva) {
      await incrementarChatsNuevos(supabase, contentId, clientId)
    }

    // ── Step 7: Mark webhook log as processed ────────────────────
    await marcarLogProcesado(supabase, webhookLogId, {
      leadId,
      ...(errorPieza ? { error: errorPieza } : {}),
    })

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
