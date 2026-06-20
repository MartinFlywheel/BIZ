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

  if (stage === 'agendado' || stage === 'agenda_set') updates.agenda_at = new Date().toISOString()
  if (stage === 'cliente' || stage === 'closed_won') updates.closed_at = new Date().toISOString()

  const { error } = await supabase.from('leads').update(updates).eq('id', id)
  if (error) throw error

  revalidatePath('/leads')
  revalidatePath('/dashboard')
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
      notes: (formData.get('notes') as string) || null,
      close_value: formData.get('close_value')
        ? parseFloat(formData.get('close_value') as string)
        : null,
      lost_reason: (formData.get('lost_reason') as string) || null,
      conversion_touch_content_id: (formData.get('conversion_touch_content_id') as string) || null,
      conversion_touch_at: formData.get('conversion_touch_content_id')
        ? new Date().toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}
