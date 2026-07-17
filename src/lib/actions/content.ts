'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ContentType } from '@/lib/types'
import { fetchAllRows } from '@/lib/supabase/paginate'

export async function getContentPieces(clientId?: string) {
  const supabase = await createClient()

  return fetchAllRows((from, to) => {
    let query = supabase
      .from('content_pieces')
      .select('*, clients(name, ig_handle), campaigns(name)')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (clientId) query = query.eq('client_id', clientId)
    return query
  })
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

  if (error) return { success: false as const, error: error.message }
  try { revalidatePath('/content'); revalidatePath(`/clients/${clientId}`) } catch {}
  return { success: true as const }
}

async function extractIgThumbnail(permalink: string): Promise<string | null> {
  // Method 1: Facebook oEmbed API (app token)
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (appId && appSecret) {
    try {
      const params = new URLSearchParams({
        url: permalink,
        access_token: `${appId}|${appSecret}`,
        fields: 'thumbnail_url',
      })
      const res = await fetch(
        `https://graph.facebook.com/v19.0/instagram_oembed?${params.toString()}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.thumbnail_url) return data.thumbnail_url
      }
    } catch { }
  }

  // Method 2: Instagram Graph API via system token
  const systemToken = process.env.META_SYSTEM_USER_TOKEN
  if (systemToken) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/oembed?url=${encodeURIComponent(permalink)}&access_token=${systemToken}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.thumbnail_url) return data.thumbnail_url
      }
    } catch { }
  }

  return null
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

export async function deleteContentAction(id: string, clientId: string) {
  const supabase = await createClient()

  await supabase.from('content_metrics').delete().eq('content_id', id)
  await supabase.from('content_notes').delete().eq('content_id', id)

  const { error } = await supabase.from('content_pieces').delete().eq('id', id)
  if (error) throw error

  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
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

export interface QuickAddResult {
  added: number
  skipped: number
  error?: string
}

export async function quickAddLatestReels(clientId: string, limit = 10): Promise<QuickAddResult> {
  const supabase = await createClient()

  // Get the integration for this client
  const { data: integration, error: intError } = await supabase
    .from('integrations')
    .select('access_token, status, token_expires_at')
    .eq('client_id', clientId)
    .eq('platform', 'instagram')
    .eq('status', 'connected')
    .single()

  if (intError || !integration) {
    return { added: 0, skipped: 0, error: 'No hay integración de Instagram conectada para este cliente.' }
  }

  if (integration.token_expires_at && new Date(integration.token_expires_at) < new Date()) {
    return { added: 0, skipped: 0, error: 'El token de Instagram ha expirado. Reconecta la integración.' }
  }

  // Fetch latest media from IG Graph API
  const mediaRes = await fetch(
    `https://graph.instagram.com/me/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&limit=${limit}&access_token=${integration.access_token}`
  )

  if (!mediaRes.ok) {
    return { added: 0, skipped: 0, error: `Error de la API de Meta: ${mediaRes.status}` }
  }

  const mediaData = await mediaRes.json()
  const mediaItems: Array<{
    id: string
    caption?: string
    media_type: string
    permalink?: string
    thumbnail_url?: string
    timestamp: string
  }> = mediaData.data || []

  // Filter only reels (VIDEO type)
  const reels = mediaItems.filter((m) => m.media_type === 'VIDEO')

  let added = 0
  let skipped = 0

  for (const media of reels) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('content_pieces')
      .select('id')
      .eq('ig_media_id', media.id)
      .eq('client_id', clientId)
      .single()

    if (existing) {
      skipped++
      continue
    }

    const { error: insertError } = await supabase.from('content_pieces').insert({
      client_id: clientId,
      content_type: 'reel',
      ig_media_id: media.id,
      ig_permalink: media.permalink || null,
      ig_thumbnail_url: media.thumbnail_url || null,
      caption: media.caption || null,
      published_at: media.timestamp,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
      metrics_source: 'manual',
      metrics_updated_at: new Date().toISOString(),
    })

    if (!insertError) {
      added++
    }
  }

  revalidatePath(`/clients/${clientId}`)
  return { added, skipped }
}
