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

interface MediaItem {
  id: string
  caption?: string | null
  media_type: string
  permalink?: string | null
  thumbnail_url?: string
  media_url?: string
  timestamp: string
}

function pickThumbnail(media: { media_type: string; thumbnail_url?: string; media_url?: string }): string | null {
  if (media.media_type === 'VIDEO' && media.thumbnail_url) return media.thumbnail_url
  if (media.media_url) return media.media_url
  return media.thumbnail_url || null
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// Fetches this one item's insights (and reel watch time) and writes the
// result — the unit of work that used to run one-at-a-time in a for loop.
async function processPlan(
  supabase: SupabaseServerClient,
  clientId: string,
  token: string,
  plan: { media: MediaItem; contentType: string; thumbnail: string | null } & (
    | { kind: 'existing'; targetId: string }
    | { kind: 'manual'; manualMatch: { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null } }
    | { kind: 'new' }
  )
): Promise<void> {
  const { media, contentType, thumbnail } = plan

  const insights = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0, total_interactions: 0 }
  const [insightsResult, watchTimeResult] = await Promise.all([
    (async () => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/${media.id}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions&access_token=${token}`
        )
        if (res.ok) return (await res.json()).data as { name: string; values?: { value: number }[] }[]
      } catch {}
      return null
    })(),
    contentType === 'reel'
      ? (async () => {
          try {
            const res = await fetch(
              `https://graph.facebook.com/${media.id}/insights?metric=ig_reels_avg_watch_time&access_token=${token}`
            )
            if (res.ok) {
              const ms = (await res.json()).data?.[0]?.values?.[0]?.value
              if (typeof ms === 'number') return Math.round(ms / 1000)
            }
          } catch {}
          return null
        })()
      : Promise.resolve(null),
  ])

  for (const metric of insightsResult || []) {
    if (metric.name in insights) insights[metric.name as keyof typeof insights] = metric.values?.[0]?.value || 0
  }
  const avgWatchTime = watchTimeResult

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

  if (plan.kind === 'existing') {
    await supabase
      .from('content_pieces')
      .update({
        ig_thumbnail_url: thumbnail,
        ig_permalink: media.permalink,
        caption: media.caption,
        ...metricFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.targetId)
  } else if (plan.kind === 'manual') {
    // Backfill ig_media_id so future syncs match directly — but never touch
    // caption/keyword_trigger, that's the label the team gave it.
    await supabase
      .from('content_pieces')
      .update({
        ig_media_id: media.id,
        ig_thumbnail_url: plan.manualMatch.ig_thumbnail_url ?? thumbnail,
        ig_permalink: plan.manualMatch.ig_permalink ?? media.permalink,
        ...metricFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.manualMatch.id)
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
    const items: MediaItem[] = mediaData.data || []

    // Pieces created manually (tagged with a keyword_trigger, sometimes
    // carrying their own revenue via content_metrics) never got an
    // ig_media_id — the API has no way to know they're the same post. Match
    // them by permalink first, then by same day + content_type, so the sync
    // fills in real metrics on the existing tagged row instead of creating
    // an untagged duplicate that orphans the revenue already logged against it.
    type ManualRow = { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null }
    const [{ data: existingRows }, { data: unmatchedRows }] = await Promise.all([
      supabase
        .from('content_pieces')
        .select('id, ig_media_id')
        .eq('client_id', clientId)
        .not('ig_media_id', 'is', null),
      supabase
        .from('content_pieces')
        .select('id, content_type, published_at, ig_permalink, ig_thumbnail_url')
        .eq('client_id', clientId)
        .is('ig_media_id', null),
    ])

    const existingByMediaId = new Map((existingRows || []).map((r) => [r.ig_media_id as string, r.id]))
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

    // Decide each item's match up front, synchronously — this is where the
    // manual-match maps get mutated, so running the slow API/DB work below
    // concurrently can't race two items onto the same manual candidate.
    type Plan = { media: MediaItem; contentType: string; thumbnail: string | null } & (
      | { kind: 'existing'; targetId: string }
      | { kind: 'manual'; manualMatch: ManualRow }
      | { kind: 'new' }
    )
    const plans: Plan[] = items.map((media) => {
      const contentType = media.media_type === 'VIDEO' ? 'reel'
        : media.media_type === 'CAROUSEL_ALBUM' ? 'post'
        : 'post'
      const thumbnail = pickThumbnail(media)

      const targetId = existingByMediaId.get(media.id)
      if (targetId) return { media, contentType, thumbnail, kind: 'existing', targetId }

      let manualMatch = (media.permalink && byPermalink.get(media.permalink)) || null
      const dayTypeKey = `${contentType}|${media.timestamp.slice(0, 10)}`
      if (!manualMatch) {
        const candidates = byDayType.get(dayTypeKey) ?? []
        if (candidates.length === 1) manualMatch = candidates[0]
      }
      if (manualMatch) {
        if (media.permalink) byPermalink.delete(media.permalink)
        byDayType.set(dayTypeKey, (byDayType.get(dayTypeKey) ?? []).filter((c) => c.id !== manualMatch!.id))
        return { media, contentType, thumbnail, kind: 'manual', manualMatch }
      }
      return { media, contentType, thumbnail, kind: 'new' }
    })

    // The slow part — a Meta API round trip (or two, for reels) per item —
    // runs in small concurrent batches instead of one item at a time.
    // Sequential was the reason a client with 30+ posts blew past Vercel's
    // 60s function cap on the Hobby plan; this account alone timed out
    // clicking "Sincronizar" once already.
    const CONCURRENCY = 8
    let processed = 0
    for (let i = 0; i < plans.length; i += CONCURRENCY) {
      const batch = plans.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map((plan) => processPlan(supabase, clientId, token, plan)))
      processed += batch.length
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
