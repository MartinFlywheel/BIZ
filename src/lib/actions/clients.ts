'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ClientStatus } from '@/lib/types'

export async function getClients() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getClient(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createClientAction(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.from('clients').insert({
    name: formData.get('name') as string,
    ig_handle: formData.get('ig_handle') as string,
    ig_account_id: (formData.get('ig_account_id') as string) || null,
    industry: (formData.get('industry') as string) || null,
    status: (formData.get('status') as ClientStatus) || 'prospect',
    monthly_fee: formData.get('monthly_fee')
      ? parseFloat(formData.get('monthly_fee') as string)
      : null,
  })

  if (error) throw error
  revalidatePath('/clients')
}

export async function updateClientAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({
      name: formData.get('name') as string,
      ig_handle: formData.get('ig_handle') as string,
      ig_account_id: (formData.get('ig_account_id') as string) || null,
      industry: (formData.get('industry') as string) || null,
      status: formData.get('status') as ClientStatus,
      monthly_fee: formData.get('monthly_fee')
        ? parseFloat(formData.get('monthly_fee') as string)
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
}

export async function deleteClientAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('clients').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/clients')
}
