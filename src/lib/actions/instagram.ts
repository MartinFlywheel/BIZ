'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function linkInstagramAccount(clientId: string, igAccountId: string) {
  const supabase = await createClient()

  const cleanId = igAccountId.trim()
  if (!cleanId) throw new Error('Instagram Account ID is required')

  const { error } = await supabase
    .from('clients')
    .update({
      ig_account_id: cleanId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
}

export async function unlinkInstagramAccount(clientId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({
      ig_account_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
}

// =====================================================
// Sync Content — pull from Instagram Graph API
// Fetches media_url (images) AND thumbnail_url (videos)
// =====================================================

const IG_MEDIA_FIELDS = 'id,caption,media_type,permalink,thumbnail_url,media_url,timestamp'

function pickThumbnail(media: { media_type: string; thumbnail_url?: string; media_url?: string }): string | null {
  if (media.media_type === 'VIDEO' && media.thumbnail_url) return media.thumbnail_url
  if (media.media_url) return media.media_url
  return media.thumbnail_url || null
}

export async function syncClientContent(clientId: string): Promise<{
  status: 'success' | 'error'
  processed: number
  message: string
}> {
  const supabase = await createClient()
  const token = process.env.META_SYSTEM_USER_TOKEN

  if (!token) {
    return { status: 'error', processed: 0, message: 'META_SYSTEM_USER_TOKEN not configured' }
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('id', clientId)
    .single()

  if (!client?.ig_account_id) {
    return { status: 'error', processed: 0, message: 'Client has no Instagram Account ID linked' }
  }

  try {
    const mediaRes = await fetch(
      `https://graph.instagram.com/${client.ig_account_id}/media?fields=${IG_MEDIA_FIELDS}&access_token=${token}&limit=50`
    )

    if (!mediaRes.ok) {
      const errorBody = await mediaRes.text()
      return { status: 'error', processed: 0, message: `Instagram API error: ${mediaRes.status} — ${errorBody}` }
    }

    const mediaData = await mediaRes.json()
    let processed = 0

    for (const media of mediaData.data || []) {
      const contentType = media.media_type === 'VIDEO' ? 'reel'
        : media.media_type === 'CAROUSEL_ALBUM' ? 'post'
        : 'post'

      const thumbnail = pickThumbnail(media)

      const { data: existing } = await supabase
        .from('content_pieces')
        .select('id')
        .eq('ig_media_id', media.id)
        .eq('client_id', clientId)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('content_pieces')
          .update({
            ig_thumbnail_url: thumbnail,
            ig_permalink: media.permalink,
            caption: media.caption,
            metrics_source: 'meta_api',
            metrics_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('content_pieces').insert({
          client_id: clientId,
          content_type: contentType,
          ig_media_id: media.id,
          ig_permalink: media.permalink,
          ig_thumbnail_url: thumbnail,
          caption: media.caption,
          published_at: media.timestamp,
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          reach: 0,
          metrics_source: 'meta_api',
          metrics_updated_at: new Date().toISOString(),
        })
      }

      processed++
    }

    revalidatePath(`/clients/${clientId}`)
    revalidatePath('/content')

    return { status: 'success', processed, message: `${processed} contenidos sincronizados` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', processed: 0, message: msg }
  }
}

// =====================================================
// Quick Add Latest Reels — pull only the latest N reels
// =====================================================

export async function quickAddLatestReels(clientId: string, limit = 10): Promise<{
  status: 'success' | 'error'
  added: number
  skipped: number
  message: string
}> {
  const supabase = await createClient()
  const token = process.env.META_SYSTEM_USER_TOKEN

  if (!token) {
    return { status: 'error', added: 0, skipped: 0, message: 'META_SYSTEM_USER_TOKEN not configured' }
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, ig_account_id')
    .eq('id', clientId)
    .single()

  if (!client?.ig_account_id) {
    return { status: 'error', added: 0, skipped: 0, message: 'Client has no Instagram Account ID linked' }
  }

  try {
    const mediaRes = await fetch(
      `https://graph.instagram.com/${client.ig_account_id}/media?fields=${IG_MEDIA_FIELDS}&access_token=${token}&limit=${limit}`
    )

    if (!mediaRes.ok) {
      const errorBody = await mediaRes.text()
      return { status: 'error', added: 0, skipped: 0, message: `API error: ${mediaRes.status} — ${errorBody}` }
    }

    const mediaData = await mediaRes.json()
    let added = 0
    let skipped = 0

    for (const media of mediaData.data || []) {
      const { data: existing } = await supabase
        .from('content_pieces')
        .select('id')
        .eq('ig_media_id', media.id)
        .eq('client_id', clientId)
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      const contentType = media.media_type === 'VIDEO' ? 'reel'
        : media.media_type === 'CAROUSEL_ALBUM' ? 'post'
        : 'post'

      await supabase.from('content_pieces').insert({
        client_id: clientId,
        content_type: contentType,
        ig_media_id: media.id,
        ig_permalink: media.permalink,
        ig_thumbnail_url: pickThumbnail(media),
        caption: media.caption,
        published_at: media.timestamp,
        views: 0,
        metrics_source: 'meta_api',
        metrics_updated_at: new Date().toISOString(),
      })

      added++
    }

    revalidatePath(`/clients/${clientId}`)

    return {
      status: 'success',
      added,
      skipped,
      message: `${added} nuevos, ${skipped} ya existían`,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', added: 0, skipped: 0, message: msg }
  }
}
