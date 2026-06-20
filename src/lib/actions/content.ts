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
  const igPermalink = (formData.get('ig_permalink') as string) || null

  const manualThumbnail = (formData.get('ig_thumbnail_url') as string) || null
  let thumbnailUrl: string | null = manualThumbnail
  if (!thumbnailUrl && igPermalink) {
    thumbnailUrl = await extractIgThumbnail(igPermalink)
  }

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
    ig_permalink: igPermalink,
    ig_thumbnail_url: thumbnailUrl,
    metrics_source: 'manual',
    metrics_updated_at: new Date().toISOString(),
  })

  if (error) throw error
  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
}

async function extractIgThumbnail(permalink: string): Promise<string | null> {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (!appId || !appSecret) return null

  try {
    const params = new URLSearchParams({
      url: permalink,
      access_token: `${appId}|${appSecret}`,
      fields: 'thumbnail_url',
    })

    const res = await fetch(
      `https://graph.facebook.com/v19.0/instagram_oembed?${params.toString()}`
    )

    if (!res.ok) return null

    const data = await res.json()
    return data.thumbnail_url || null
  } catch {
    return null
  }
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

export async function upsertContentMetrics(contentId: string, clientId: string, formData: FormData) {
  const supabase = await createClient()

  const payload = {
    content_id: contentId,
    client_id: clientId,
    chats_nuevos: parseInt(formData.get('chats_nuevos') as string) || 0,
    conversaciones_nuevas: parseInt(formData.get('conversaciones') as string) || 0,
    agendas: parseInt(formData.get('agendas') as string) || 0,
    shows: parseInt(formData.get('shows') as string) || 0,
    cierres: parseInt(formData.get('cierres') as string) || 0,
    ticket: formData.get('ticket') ? parseFloat(formData.get('ticket') as string) : null,
    aov: formData.get('aov') ? parseFloat(formData.get('aov') as string) : null,
    cash_collected: formData.get('cash_collected') ? parseFloat(formData.get('cash_collected') as string) : null,
    manychat_label: (formData.get('manychat_label') as string) || null,
    notes: (formData.get('notes') as string) || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('content_metrics')
    .upsert(payload, { onConflict: 'content_id' })

  if (error) throw error
  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
}

export async function getContentMetricsByClient(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_metrics')
    .select('*')
    .eq('client_id', clientId)

  if (error) throw error
  return data
}
