'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInstagramDM } from '@/lib/services/instagram-messaging'
import type { IncomingMessage } from '@/lib/types'
// Same rule as the CRM tab's own leads list (getLeadsForViewer in
// src/lib/actions/leads.ts), re-checked here since this page is reachable by
// a direct URL. Vive en lead-access.ts porque la línea de tiempo del lead usa
// exactamente la misma regla.
import { assertCanViewLead } from './lead-access'

export async function getLeadChatHeader(leadId: string) {
  const { lead } = await assertCanViewLead(leadId)
  return { fullName: lead.full_name, igUsername: lead.ig_username, clientId: lead.client_id }
}

export async function getLeadMessages(leadId: string): Promise<IncomingMessage[]> {
  const { supabase } = await assertCanViewLead(leadId)

  const { data, error } = await supabase
    .from('incoming_messages')
    .select('*')
    .eq('lead_id', leadId)
    .order('received_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as IncomingMessage[]
}

export async function sendLeadMessage(leadId: string, text: string): Promise<{ success: true } | { success: false; error: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { success: false, error: 'Mensaje vacío' }

  try {
    const { lead, currentUserId } = await assertCanViewLead(leadId)

    const { data: client } = await (await createClient())
      .from('clients')
      .select('ig_account_id')
      .eq('id', lead.client_id)
      .single()

    if (!client?.ig_account_id) {
      return { success: false, error: 'Este cliente no tiene una cuenta de Instagram conectada (ig_account_id)' }
    }

    // The recipient's IGSID only exists once they've messaged the account
    // directly at least once — Meta requires an open conversation, you
    // can't cold-message a lead who's only interacted via the ManyChat bot
    // flow without ever DMing the account itself.
    const admin = createAdminClient()
    const { data: lastInbound } = await admin
      .from('incoming_messages')
      .select('sender_ig_id')
      .eq('lead_id', leadId)
      .eq('direction', 'inbound')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastInbound?.sender_ig_id) {
      return { success: false, error: 'Todavía no tenemos un DM directo de esta persona — no se le puede escribir primero' }
    }

    await sendInstagramDM(client.ig_account_id, lastInbound.sender_ig_id, trimmed)

    await admin.from('incoming_messages').insert({
      sender_ig_id: client.ig_account_id,
      recipient_ig_id: lastInbound.sender_ig_id,
      message_text: trimmed,
      message_type: 'text',
      status: 'read',
      client_id: lead.client_id,
      lead_id: leadId,
      direction: 'outbound',
      sent_by: currentUserId,
      received_at: new Date().toISOString(),
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}
