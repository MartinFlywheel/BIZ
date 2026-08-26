'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getAppUrl } from '@/lib/env'

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
      `https://graph.facebook.com/${client.ig_account_id}/media?fields=${IG_MEDIA_FIELDS}&access_token=${token}&limit=50`
    )

    if (!mediaRes.ok) {
      const errorBody = await mediaRes.text()
      return { status: 'error', processed: 0, message: `Instagram API error: ${mediaRes.status} — ${errorBody}` }
    }

    const mediaData = await mediaRes.json()
    let processed = 0

    // Pieces created manually (tagged with a keyword_trigger, sometimes
    // carrying their own revenue via content_metrics) never got an
    // ig_media_id — the API has no way to know they're the same post. Match
    // them by permalink first, then by same day + content_type, so the sync
    // fills in real metrics on the existing tagged row instead of creating
    // an untagged duplicate that orphans the revenue already logged against it.
    type ManualRow = { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null }
    const { data: unmatchedRows } = await supabase
      .from('content_pieces')
      .select('id, content_type, published_at, ig_permalink, ig_thumbnail_url')
      .eq('client_id', clientId)
      .is('ig_media_id', null)

    const byPermalink = new Map<string, ManualRow>()
    const byDayType = new Map<string, ManualRow[]>()
    for (const row of unmatchedRows || []) {
      if (row.ig_permalink) byPermalink.set(row.ig_permalink, row)
      if (row.published_at) {
        const key = `${row.content_type}|${row.published_at.slice(0, 10)}`
        const arr = byDayType.get(key) ?? []
        arr.push(row)
        byDayType.set(key, arr)
      }
    }

    for (const media of mediaData.data || []) {
      const contentType = media.media_type === 'VIDEO' ? 'reel'
        : media.media_type === 'CAROUSEL_ALBUM' ? 'post'
        : 'post'

      const thumbnail = pickThumbnail(media)

      // Real numbers, not placeholders — the daily cron (sync-instagram)
      // would eventually backfill these anyway, but that meant a manual
      // "Sincronizar" click showed 0 views on anything it hadn't already
      // seen until up to 24h later. "impressions" was deprecated April
      // 2025 in favor of a universal "views" metric — same fix applied
      // here as in the cron.
      let insights = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0, total_interactions: 0 }
      try {
        const insightsRes = await fetch(
          `https://graph.facebook.com/${media.id}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions&access_token=${token}`
        )
        if (insightsRes.ok) {
          const insightsData = await insightsRes.json()
          for (const metric of insightsData.data || []) {
            if (metric.name in insights) insights[metric.name as keyof typeof insights] = metric.values?.[0]?.value || 0
          }
        }
      } catch {}

      let avgWatchTime: number | null = null
      if (contentType === 'reel') {
        try {
          const watchRes = await fetch(
            `https://graph.facebook.com/${media.id}/insights?metric=ig_reels_avg_watch_time&access_token=${token}`
          )
          if (watchRes.ok) {
            const watchData = await watchRes.json()
            const ms = watchData.data?.[0]?.values?.[0]?.value
            if (typeof ms === 'number') avgWatchTime = Math.round(ms / 1000)
          }
        } catch {}
      }

      const { data: existing } = await supabase
        .from('content_pieces')
        .select('id')
        .eq('ig_media_id', media.id)
        .eq('client_id', clientId)
        .maybeSingle()

      let manualMatch: ManualRow | null = null
      const day = media.timestamp.slice(0, 10)
      const dayTypeKey = `${contentType}|${day}`
      if (!existing) {
        manualMatch = (media.permalink && byPermalink.get(media.permalink)) || null
        if (!manualMatch) {
          const candidates = byDayType.get(dayTypeKey) ?? []
          if (candidates.length === 1) manualMatch = candidates[0]
        }
      }

      const metricFields = {
        views: insights.views,
        reach: insights.reach,
        likes: insights.likes,
        comments: insights.comments,
        shares: insights.shares,
        saves: insights.saved,
        total_interactions: insights.total_interactions,
        ...(avgWatchTime !== null && { avg_watch_time_seconds: avgWatchTime }),
        metrics_source: 'meta_api' as const,
        metrics_updated_at: new Date().toISOString(),
      }

      if (existing) {
        await supabase
          .from('content_pieces')
          .update({
            ig_thumbnail_url: thumbnail,
            ig_permalink: media.permalink,
            caption: media.caption,
            ...metricFields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else if (manualMatch) {
        // Backfill ig_media_id so future syncs match directly — but never
        // touch caption/keyword_trigger, that's the label the team gave it.
        await supabase
          .from('content_pieces')
          .update({
            ig_media_id: media.id,
            ig_thumbnail_url: manualMatch.ig_thumbnail_url ?? thumbnail,
            ig_permalink: manualMatch.ig_permalink ?? media.permalink,
            ...metricFields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', manualMatch.id)

        if (media.permalink) byPermalink.delete(media.permalink)
        byDayType.set(dayTypeKey, (byDayType.get(dayTypeKey) ?? []).filter((c) => c.id !== manualMatch!.id))
      } else {
        await supabase.from('content_pieces').insert({
          client_id: clientId,
          content_type: contentType,
          ig_media_id: media.id,
          ig_permalink: media.permalink,
          ig_thumbnail_url: thumbnail,
          caption: media.caption,
          published_at: media.timestamp,
          ...metricFields,
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
// Quick Add Latest Reels — triggers n8n to scrape via Apify
// Same pipeline as competitors, no API token needed
// =====================================================

export async function quickAddLatestReels(clientId: string, limit = 10): Promise<{
  status: 'success' | 'error'
  added: number
  skipped: number
  message: string
}> {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, ig_handle, name')
    .eq('id', clientId)
    .single()

  if (!client?.ig_handle) {
    return { status: 'error', added: 0, skipped: 0, message: 'El cliente no tiene handle de Instagram' }
  }

  const n8nUrl = process.env.N8N_COMPETITOR_SYNC_URL
  if (!n8nUrl) {
    return { status: 'error', added: 0, skipped: 0, message: 'N8N_COMPETITOR_SYNC_URL not configured' }
  }

  const igHandle = client.ig_handle.replace(/^@/, '')

  try {
    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        target: 'client',
        ig_handle: igHandle,
        instagram_profile_url: `https://www.instagram.com/${igHandle}/`,
        callback_url: `${getAppUrl()}/api/webhooks/client-content-sync`,
      }),
    })

    if (!res.ok) {
      return { status: 'error', added: 0, skipped: 0, message: `n8n error: ${res.status}` }
    }

    return {
      status: 'success',
      added: 0,
      skipped: 0,
      message: 'Sincronización iniciada — los reels aparecerán en unos segundos',
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', added: 0, skipped: 0, message: msg }
  }
}
