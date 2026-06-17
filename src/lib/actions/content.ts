'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ContentType } from '@/lib/types'

export async function getContentPieces(clientId?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('content_pieces')
    .select('*, clients(name, ig_handle), campaigns(name)')
    .order('published_at', { ascending: false })

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createContentAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase.from('content_pieces').insert({
    client_id: clientId,
    campaign_id: (formData.get('campaign_id') as string) || null,
    content_type: formData.get('content_type') as ContentType,
    caption: (formData.get('caption') as string) || null,
    keyword_trigger: (formData.get('keyword_trigger') as string) || null,
    published_at: (formData.get('published_at') as string) || null,
    views: parseInt(formData.get('views') as string) || 0,
    likes: parseInt(formData.get('likes') as string) || 0,
    comments: parseInt(formData.get('comments') as string) || 0,
    shares: parseInt(formData.get('shares') as string) || 0,
    saves: parseInt(formData.get('saves') as string) || 0,
    reach: parseInt(formData.get('reach') as string) || 0,
    ig_permalink: (formData.get('ig_permalink') as string) || null,
    metrics_source: 'manual',
    metrics_updated_at: new Date().toISOString(),
  })

  if (error) throw error
  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
}

export async function updateContentAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('content_pieces')
    .update({
      campaign_id: (formData.get('campaign_id') as string) || null,
      content_type: formData.get('content_type') as ContentType,
      caption: (formData.get('caption') as string) || null,
      keyword_trigger: (formData.get('keyword_trigger') as string) || null,
      published_at: (formData.get('published_at') as string) || null,
      views: parseInt(formData.get('views') as string) || 0,
      likes: parseInt(formData.get('likes') as string) || 0,
      comments: parseInt(formData.get('comments') as string) || 0,
      shares: parseInt(formData.get('shares') as string) || 0,
      saves: parseInt(formData.get('saves') as string) || 0,
      reach: parseInt(formData.get('reach') as string) || 0,
      metrics_source: 'manual',
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/content')
}

export async function deleteContentAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('content_pieces').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/content')
}
