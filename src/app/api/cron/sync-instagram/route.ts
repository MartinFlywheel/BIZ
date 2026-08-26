import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// "impressions" was deprecated April 21, 2025 — Meta merged
// impressions/plays/video_views into one universal "views" metric.
// Requesting the old name either 400s or silently returns nothing,
// which is why pieces kept syncing at 0.
const GENERAL_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions'

interface Insights {
  views: number
  reach: number
  likes: number
  comments: number
  shares: number
  saved: number
  total_interactions: number
}

async function fetchInsights(mediaId: string, token: string): Promise<Insights> {
  const insights: Insights = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0, total_interactions: 0 }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${mediaId}/insights?metric=${GENERAL_METRICS}&access_token=${token}`
    )
    if (res.ok) {
      const data = await res.json()
      for (const metric of data.data || []) {
        if (metric.name in insights) insights[metric.name as keyof Insights] = metric.values?.[0]?.value || 0
      }
    }
  } catch {}
  return insights
}

// Reels-only — average watch time isn't part of the general metric set
// and Meta rejects the whole request if you mix incompatible metrics for
// the media type, so this is its own call. Comes back in milliseconds.
async function fetchReelWatchTime(mediaId: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${mediaId}/insights?metric=ig_reels_avg_watch_time&access_token=${token}`
    )
    if (!res.ok) return null
    const data = await res.json()
    const ms = data.data?.[0]?.values?.[0]?.value
    return typeof ms === 'number' ? Math.round(ms / 1000) : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'META_SYSTEM_USER_TOKEN not configured' }, { status: 500 })
  }

  const supabase = createAdminClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('status', 'active')
    .not('ig_account_id', 'is', null)

  if (!clients || clients.length === 0) {
    return NextResponse.json({ status: 'no_clients_with_ig' })
  }

  const results = []

  for (const client of clients) {
    try {
      const mediaRes = await fetch(
        `https://graph.facebook.com/${client.ig_account_id}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&access_token=${token}&limit=50`
      )

      if (!mediaRes.ok) {
        results.push({ client: client.ig_handle, status: 'error', error: `API ${mediaRes.status}` })
        continue
      }

      const mediaData = await mediaRes.json()
      let processed = 0

      // Pieces created manually (tagged with a keyword_trigger, sometimes
      // carrying their own revenue via content_metrics) never got an
      // ig_media_id. Match them by permalink first, then by same day +
      // content_type, so the cron fills in real metrics on the existing
      // tagged row instead of creating an untagged duplicate that orphans
      // the revenue already logged against it.
      type ManualRow = { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null }
      const { data: unmatchedRows } = await supabase
        .from('content_pieces')
        .select('id, content_type, published_at, ig_permalink, ig_thumbnail_url')
        .eq('client_id', client.id)
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

        const insights = await fetchInsights(media.id, token)
        const avgWatchTime = contentType === 'reel' ? await fetchReelWatchTime(media.id, token) : null

        const { data: existing } = await supabase
          .from('content_pieces')
          .select('id')
          .eq('ig_media_id', media.id)
          .eq('client_id', client.id)
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
            .update({ ...metricFields, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        } else if (manualMatch) {
          // Backfill ig_media_id so future syncs match directly — but never
          // touch caption/keyword_trigger, that's the label the team gave it.
          await supabase
            .from('content_pieces')
            .update({
              ig_media_id: media.id,
              ig_thumbnail_url: manualMatch.ig_thumbnail_url ?? media.thumbnail_url,
              ig_permalink: manualMatch.ig_permalink ?? media.permalink,
              ...metricFields,
              updated_at: new Date().toISOString(),
            })
            .eq('id', manualMatch.id)

          if (media.permalink) byPermalink.delete(media.permalink)
          byDayType.set(dayTypeKey, (byDayType.get(dayTypeKey) ?? []).filter((c) => c.id !== manualMatch!.id))
        } else {
          await supabase.from('content_pieces').insert({
            client_id: client.id,
            content_type: contentType,
            ig_media_id: media.id,
            ig_permalink: media.permalink,
            ig_thumbnail_url: media.thumbnail_url,
            caption: media.caption,
            published_at: media.timestamp,
            ...metricFields,
          })
        }

        processed++
      }

      results.push({ client: client.ig_handle, status: 'success', processed })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown'
      results.push({ client: client.ig_handle, status: 'error', error: msg })
    }
  }

  return NextResponse.json({ results })
}
