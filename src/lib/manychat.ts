import type { createAdminClient } from '@/lib/supabase/admin'

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
