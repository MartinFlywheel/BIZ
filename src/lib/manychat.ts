import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type Classification = 'chat_abierto' | 'conversacion_real' | 'lead_calificado' | 'disqualified'

const VALID_CLASSIFICATIONS: Classification[] = ['chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified']

// Qué clasificaciones anteriores puede "promover en el lugar" cada
// clasificación nueva — chat_abierto -> conversacion_real -> lead_calificado
// es una progresión, así que promover a una etapa tiene que poder
// encontrar la fila en CUALQUIER etapa previa, no solo en chat_abierto.
// Incluye la propia clasificación destino: si el nodo de ManyChat se
// dispara dos veces para la misma persona (reintento, flujo con loop, CTA
// tocado de nuevo), la segunda llamada tiene que encontrar y actualizar la
// fila que ya quedó en esa etapa — si no, no matchea nada y cae al INSERT,
// duplicando la interacción en vez de "promoverla en el lugar".
const PROMOTABLE_FROM: Record<Classification, Classification[]> = {
  chat_abierto: [],
  conversacion_real: ['chat_abierto', 'conversacion_real'],
  lead_calificado: ['chat_abierto', 'conversacion_real', 'lead_calificado'],
  disqualified: ['chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified'],
}

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

// Campos que ya tienen un significado fijo en el payload — todo lo demás
// que llegue (sea porque se armó a mano campo por campo en el editor de
// ManyChat, o porque viene adentro de custom_fields) se guarda como parte
// de la ficha de calificación.
const RESERVED_PAYLOAD_KEYS = new Set([
  'ig_username', 'instagram_user_handle', 'username', 'instagram_username',
  'full_name', 'name', 'first_name', 'last_name',
  'email', 'phone', 'phone_number',
  'subscriber_id', 'id',
  'classification', 'event', 'stage', 'tags', 'custom_fields', 'qualified', 'pieceId',
])

// ManyChat manda los custom fields de dos formas distintas según cómo se
// arme la solicitud: como objeto plano ({"nivel": "..."}) si se escriben a
// mano, o como el array [{name, value}, ...] que trae "Full Contact Data"
// de forma nativa. Se soportan ambas, más cualquier campo suelto que se
// haya agregado directo al cuerpo (fuera de "custom_fields").
function extractCustomFields(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  const raw = payload.custom_fields
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'name' in entry) {
        const name = (entry as { name?: unknown }).name
        const value = (entry as { value?: unknown }).value
        if (typeof name === 'string' && value !== null && value !== undefined && value !== '') {
          result[name] = value
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    Object.assign(result, raw as Record<string, unknown>)
  }

  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_PAYLOAD_KEYS.has(key)) continue
    if (value === null || value === undefined || value === '') continue
    result[key] = value
  }

  return result
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
// than "chat_abierto", first looks for a recent promotable row from the
// same person and promotes it in place — so a multi-call ManyChat flow
// (entry, quiz answers, reply) produces ONE interaction that upgrades over
// time, instead of separate rows that would double-count "chats abiertos".
// Returns the id of the interaction row that was written to, so the caller
// can link it back onto the lead (leads.interaction_id).
export async function upsertInteraction(supabase: AdminClient, params: InteractionParams): Promise<string> {
  const now = new Date().toISOString()

  if (params.classification !== 'chat_abierto' && params.igUsername) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('interactions')
      .select('id, prequalification_data')
      .eq('client_id', params.clientId)
      .eq('ig_username', params.igUsername)
      .in('classification', PROMOTABLE_FROM[params.classification])
      .gte('bot_triggered_at', since)
      .order('bot_triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Merge, don't replace — earlier steps in the ManyChat quiz (nivel,
      // zona) may have already landed custom fields on this row before this
      // later call (edad, ocupación) arrives.
      const mergedFields = {
        ...((existing.prequalification_data as Record<string, unknown>) || {}),
        ...(params.customFields || {}),
      }
      await supabase
        .from('interactions')
        .update({
          classification: params.classification,
          prospect_responded_at: now,
          qualified_at: (params.classification === 'conversacion_real' || params.classification === 'lead_calificado') ? now : null,
          prequalification_data: mergedFields,
          updated_at: now,
        })
        .eq('id', existing.id)
      return existing.id
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('interactions')
    .insert({
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
      qualified_at: (params.classification === 'conversacion_real' || params.classification === 'lead_calificado') ? now : null,
      prequalification_data: params.customFields || {},
      promoted_to_lead: true,
    })
    .select('id')
    .single()

  if (insertError || !inserted) throw insertError || new Error('Failed to insert interaction')
  return inserted.id
}

// ── Shared handler for the per-piece webhook URLs ───────────────────────────
// Two ManyChat "External Request" nodes call the same logic with a different
// forced classification, so which node fires depends only on where it sits
// in the flow — no JSON body editing required on the ManyChat side:
//   /api/webhooks/manychat/{pieceId}                → conversacion_real (existing node, after the reply)
//   /api/webhooks/manychat/{pieceId}/chat-abierto    → chat_abierto (new node, at the CTA/trigger)

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

    // Whatever ManyChat's flow has collected so far (nivel, zona, edad,
    // ocupación, etc.) — passed through as-is into prequalification_data,
    // no fixed schema on this side so the flow can add fields without a
    // code change here.
    const customFields = extractCustomFields(payload)

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
          content_id: contentId,
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
    const interactionId = await upsertInteraction(supabase, {
      clientId,
      contentId,
      igUsername,
      fullName,
      subscriberId,
      keywordUsed: pieceId,
      classification,
      customFields,
    })

    // Link the lead to its interaction so the CRM can show the
    // prequalification_data (nivel/zona/edad/ocupación/etc.) on the lead's
    // card — kept current on every call, not just the first.
    await supabase.from('leads').update({ interaction_id: interactionId }).eq('id', leadId)

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
