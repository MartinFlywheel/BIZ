'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Responsibility } from '@/lib/types'

export async function getTeamAssignments(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_assignments')
    .select('*, users(full_name, email, role)')
    .eq('client_id', clientId)
    .order('responsibility')

  if (error) throw error
  return data
}

export async function getAgencyUsers() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('user_type', 'agency')
    .eq('is_active', true)
    .order('full_name')

  if (error) throw error
  return data
}

export async function createAssignmentAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase.from('team_assignments').insert({
    client_id: clientId,
    user_id: formData.get('user_id') as string,
    responsibility: formData.get('responsibility') as Responsibility,
    is_primary: formData.get('is_primary') === 'true',
  })

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function getAgendaTeamStats(clientId: string): Promise<Record<string, { agendas: number; shows: number; cerradas: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agenda_records')
    .select('closer, estado')
    .eq('client_id', clientId)
    .not('closer', 'is', null)

  if (error) throw error

  const stats: Record<string, { agendas: number; shows: number; cerradas: number }> = {}
  for (const r of data ?? []) {
    const closer = r.closer?.trim()
    if (!closer) continue
    if (!stats[closer]) stats[closer] = { agendas: 0, shows: 0, cerradas: 0 }
    stats[closer].agendas++
    if (r.estado === 'Show' || r.estado === 'Cerrado') stats[closer].shows++
    if (r.estado === 'Cerrado') stats[closer].cerradas++
  }

  return stats
}

export async function updateAgencyUserAction(
  userId: string,
  fields: { full_name?: string; email?: string; role?: string }
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('users')
    .update(fields)
    .eq('id', userId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function deleteAssignmentAction(id: string, clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('team_assignments').delete().eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}
