'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { InteractionClassification, InteractionSource } from '@/lib/types'

export async function getInteractions(clientId?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('interactions')
    .select('*, clients(name, ig_handle), content_pieces(content_type, caption)')
    .order('bot_triggered_at', { ascending: false })

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createInteractionAction(formData: FormData) {
  const supabase = await createClient()
  const classification = formData.get('classification') as InteractionClassification

  const { error } = await supabase.from('interactions').insert({
    client_id: formData.get('client_id') as string,
    content_id: (formData.get('content_id') as string) || null,
    campaign_id: (formData.get('campaign_id') as string) || null,
    ig_username: (formData.get('ig_username') as string) || null,
    prospect_name: (formData.get('prospect_name') as string) || null,
    classification,
    source: (formData.get('source') as InteractionSource) || 'manual',
    keyword_used: (formData.get('keyword_used') as string) || null,
    bot_triggered_at: (formData.get('bot_triggered_at') as string) || new Date().toISOString(),
    prospect_responded_at:
      classification === 'conversacion_real' || classification === 'disqualified'
        ? new Date().toISOString()
        : null,
    qualified_at:
      classification === 'conversacion_real' ? new Date().toISOString() : null,
  })

  if (error) throw error
  revalidatePath('/dashboard')
  revalidatePath('/content')
}

export async function promoteToLeadAction(interactionId: string, formData: FormData) {
  const supabase = await createClient()

  const { data: interaction, error: fetchError } = await supabase
    .from('interactions')
    .select('*')
    .eq('id', interactionId)
    .single()

  if (fetchError || !interaction) throw fetchError || new Error('Interaction not found')

  const { error: leadError } = await supabase.from('leads').insert({
    client_id: interaction.client_id,
    interaction_id: interactionId,
    ig_username: interaction.ig_username,
    full_name: (formData.get('full_name') as string) || interaction.prospect_name,
    phone: (formData.get('phone') as string) || null,
    email: (formData.get('email') as string) || null,
    stage: 'new',
    assigned_to: (formData.get('assigned_to') as string) || null,
    first_touch_content_id: interaction.content_id,
    first_touch_at: interaction.bot_triggered_at,
    first_touch_type: 'keyword_dm',
  })

  if (leadError) throw leadError

  await supabase
    .from('interactions')
    .update({ promoted_to_lead: true, updated_at: new Date().toISOString() })
    .eq('id', interactionId)

  revalidatePath('/leads')
  revalidatePath('/dashboard')
}

export async function bulkImportInteractionsAction(
  clientId: string,
  rows: Array<{
    ig_username?: string
    prospect_name?: string
    classification: InteractionClassification
    keyword_used?: string
    bot_triggered_at?: string
  }>
) {
  const supabase = await createClient()

  const records = rows.map((row) => ({
    client_id: clientId,
    ig_username: row.ig_username || null,
    prospect_name: row.prospect_name || null,
    classification: row.classification,
    source: 'manual' as const,
    keyword_used: row.keyword_used || null,
    bot_triggered_at: row.bot_triggered_at || new Date().toISOString(),
    prospect_responded_at:
      row.classification === 'conversacion_real' || row.classification === 'disqualified'
        ? row.bot_triggered_at || new Date().toISOString()
        : null,
    qualified_at:
      row.classification === 'conversacion_real'
        ? row.bot_triggered_at || new Date().toISOString()
        : null,
  }))

  const { error } = await supabase.from('interactions').insert(records)
  if (error) throw error

  revalidatePath('/dashboard')
}
