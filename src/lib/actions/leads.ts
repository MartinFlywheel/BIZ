'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { LeadStage } from '@/lib/types'

export async function getLeads(clientId?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('leads')
    .select('*, clients(name, ig_handle), users!leads_assigned_to_fkey(full_name)')
    .order('updated_at', { ascending: false })

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateLeadStageAction(id: string, stage: LeadStage) {
  const supabase = await createClient()

  const updates: Record<string, unknown> = {
    stage,
    updated_at: new Date().toISOString(),
  }

  const isAgendaStage = stage === 'agendado' || stage === 'agenda_set'
  if (isAgendaStage) updates.agenda_at = new Date().toISOString()
  if (stage === 'cliente' || stage === 'closed_won') updates.closed_at = new Date().toISOString()

  const { data: lead, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, full_name, content_id, first_touch_at, first_touch_type, lead_avatar')
    .single()
  if (error) throw error

  // No Calendly (or not yet configured) still needs the booking to show up
  // in Agendas and roll into the funnel — create the linked record once,
  // pre-filled with what we already know, so only the call outcome is left
  // to fill in manually.
  if (isAgendaStage && lead) {
    await ensureAgendaRecordForLead(supabase, lead)
  }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
}

async function ensureAgendaRecordForLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead: { id: string; client_id: string; full_name: string | null; content_id: string | null; first_touch_at: string | null; first_touch_type: string | null; lead_avatar: string | null }
) {
  const { data: existing } = await supabase
    .from('agenda_records')
    .select('id')
    .eq('lead_id', lead.id)
    .maybeSingle()
  if (existing) return

  let keyword: string | null = null
  if (lead.content_id) {
    const { data: cp } = await supabase
      .from('content_pieces')
      .select('keyword_trigger')
      .eq('id', lead.content_id)
      .maybeSingle()
    keyword = cp?.keyword_trigger || null
  }
  // Fallback: piece-based ManyChat webhooks stamp first_touch_type as
  // "manychat:{pieceId}" — pull the keyword out of that if content_id
  // itself never resolved (older leads, or the lookup above came up empty).
  if (!keyword && lead.first_touch_type) {
    keyword = lead.first_touch_type.match(/^manychat:(.+)$/)?.[1] || null
  }

  await supabase.from('agenda_records').insert({
    client_id: lead.client_id,
    lead_id: lead.id,
    nombre_lead: lead.full_name,
    avatar: lead.lead_avatar,
    fecha_agenda: new Date().toISOString().split('T')[0],
    fecha_1er_contacto: lead.first_touch_at ? lead.first_touch_at.split('T')[0] : null,
    primer_cta: keyword,
    // The visible "CTA" column in Agendas reads de_donde_vino, not primer_cta
    de_donde_vino: keyword,
    estado: 'Pendiente',
  })
}

export async function updateLeadAvatarAction(id: string, avatar: string | null) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      lead_avatar: avatar,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function addLeadEventAction(id: string, event: string) {
  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('events')
    .eq('id', id)
    .single()

  const currentEvents: string[] = lead?.events || []
  if (currentEvents.includes(event)) return

  const { error } = await supabase
    .from('leads')
    .update({
      events: [...currentEvents, event],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function removeLeadEventAction(id: string, event: string) {
  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('events')
    .eq('id', id)
    .single()

  const currentEvents: string[] = lead?.events || []

  const { error } = await supabase
    .from('leads')
    .update({
      events: currentEvents.filter((e) => e !== event),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function updateLeadAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      full_name: (formData.get('full_name') as string) || null,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      assigned_to: (formData.get('assigned_to') as string) || null,
      lead_avatar: (formData.get('lead_avatar') as string) || null,
      content_id: (formData.get('content_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
      close_value: formData.get('close_value')
        ? parseFloat(formData.get('close_value') as string)
        : null,
      lost_reason: (formData.get('lost_reason') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function createLeadAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase.from('leads').insert({
    client_id: clientId,
    ig_username: (formData.get('ig_username') as string) || null,
    full_name: (formData.get('full_name') as string) || null,
    phone: (formData.get('phone') as string) || null,
    email: (formData.get('email') as string) || null,
    stage: (formData.get('stage') as LeadStage) || 'nuevo_contacto',
    content_id: (formData.get('content_id') as string) || null,
    lead_avatar: (formData.get('lead_avatar') as string) || null,
    close_value: formData.get('close_value')
      ? parseFloat(formData.get('close_value') as string)
      : null,
  })

  if (error) throw error
  revalidatePath('/leads')
  revalidatePath(`/clients/${clientId}`)
}

export async function updateLeadFieldsAction(id: string, fields: {
  full_name?: string | null
  ig_username?: string | null
  phone?: string | null
  email?: string | null
  lead_avatar?: string | null
  assigned_to?: string | null
  content_id?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteLeadAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
}

export async function assignLeadContentAction(leadId: string, contentId: string | null) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      content_id: contentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  if (error) throw error
  revalidatePath('/leads')
}
