'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getCompetitors(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('client_id', clientId)
    .order('name')

  if (error) throw error
  return data
}

export async function getCompetitorWithReels(competitorId: string) {
  const supabase = await createClient()

  const { data: competitor } = await supabase
    .from('competitors')
    .select('*')
    .eq('id', competitorId)
    .single()

  const { data: reels } = await supabase
    .from('competitor_reels')
    .select('*')
    .eq('competitor_id', competitorId)
    .order('published_at', { ascending: false })
    .limit(50)

  return { competitor, reels: reels || [] }
}

export async function createCompetitorAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const igHandle = (formData.get('ig_handle') as string)?.replace(/^@/, '').trim() || null

  const { error } = await supabase.from('competitors').insert({
    client_id: clientId,
    name: formData.get('name') as string,
    ig_handle: igHandle,
    ig_profile_url: igHandle ? `https://instagram.com/${igHandle}` : null,
    ig_account_id: (formData.get('ig_account_id') as string) || null,
    analisis_estrategico: (formData.get('analisis_estrategico') as string) || null,
  })

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function updateCompetitorAction(id: string, formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const igHandle = (formData.get('ig_handle') as string)?.replace(/^@/, '').trim() || null

  const { error } = await supabase
    .from('competitors')
    .update({
      name: formData.get('name') as string,
      ig_handle: igHandle,
      ig_profile_url: igHandle ? `https://instagram.com/${igHandle}` : null,
      ig_account_id: (formData.get('ig_account_id') as string) || null,
      analisis_estrategico: (formData.get('analisis_estrategico') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function deleteCompetitorAction(id: string, clientId: string) {
  const supabase = await createClient()

  await supabase.from('competitor_reels').delete().eq('competitor_id', id)
  const { error } = await supabase.from('competitors').delete().eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}
