'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getCampaigns(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('client_id', clientId)
    .order('start_date', { ascending: false })

  if (error) throw error
  return data
}

export async function createCampaignAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase.from('campaigns').insert({
    client_id: clientId,
    name: formData.get('name') as string,
    start_date: formData.get('start_date') as string,
    end_date: (formData.get('end_date') as string) || null,
    goal: (formData.get('goal') as string) || null,
    status: (formData.get('status') as string) || 'draft',
  })

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function updateCampaignAction(id: string, formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase
    .from('campaigns')
    .update({
      name: formData.get('name') as string,
      start_date: formData.get('start_date') as string,
      end_date: (formData.get('end_date') as string) || null,
      goal: (formData.get('goal') as string) || null,
      status: formData.get('status') as string,
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function deleteCampaignAction(id: string, clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('campaigns').delete().eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}
