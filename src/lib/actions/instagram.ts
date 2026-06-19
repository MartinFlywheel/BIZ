'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// =====================================================
// Link Instagram Account — paste ig_account_id, done
// =====================================================

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
// Uses META_SYSTEM_USER_TOKEN (env var), not per-client OAuth
// =====================================================

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
      `https://graph.instagram.com/${client.ig_account_id}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&access_token=${token}&limit=50`
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

      let insights = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0 }
      try {
        const insightsRes = await fetch(
          `https://graph.instagram.com/${media.id}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${token}`
        )
        if (insightsRes.ok) {
          const insightsData = await insightsRes.json()
          for (const metric of insightsData.data || []) {
            insights[metric.name as keyof typeof insights] = metric.values?.[0]?.value || 0
          }
        }
      } catch {}

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
            views: insights.impressions,
            reach: insights.reach,
            likes: insights.likes,
            comments: insights.comments,
            shares: insights.shares,
            saves: insights.saved,
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
          ig_thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          published_at: media.timestamp,
          views: insights.impressions,
          reach: insights.reach,
          likes: insights.likes,
          comments: insights.comments,
          shares: insights.shares,
          saves: insights.saved,
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
