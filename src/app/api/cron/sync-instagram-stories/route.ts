import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Stories vanish 24h after posting, and Meta's API only exposes a story
// while it's still live — there's no historical lookup once it expires,
// unlike Reels/posts. So this can't be a once-a-day job like
// sync-instagram: it has to catch each story WHILE it's up (see
// vercel.json — runs every few hours) and snapshot whatever numbers it
// has at that moment, refreshing on every pass until the story expires.
const STORY_METRICS = 'views,reach,replies,taps_forward,taps_back,exits,total_interactions'

interface StoryInsights {
  views: number
  reach: number
  replies: number
  taps_forward: number
  taps_back: number
  exits: number
  total_interactions: number
}

async function fetchStoryInsights(mediaId: string, token: string): Promise<StoryInsights> {
  const insights: StoryInsights = { views: 0, reach: 0, replies: 0, taps_forward: 0, taps_back: 0, exits: 0, total_interactions: 0 }
  try {
    const res = await fetch(
      `https://graph.instagram.com/${mediaId}/insights?metric=${STORY_METRICS}&access_token=${token}`
    )
    if (res.ok) {
      const data = await res.json()
      for (const metric of data.data || []) {
        if (metric.name in insights) insights[metric.name as keyof StoryInsights] = metric.values?.[0]?.value || 0
      }
    }
  } catch {}
  return insights
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
      const storiesRes = await fetch(
        `https://graph.instagram.com/${client.ig_account_id}/stories?fields=id,media_type,permalink,timestamp&access_token=${token}`
      )

      if (!storiesRes.ok) {
        results.push({ client: client.ig_handle, status: 'error', error: `API ${storiesRes.status}` })
        continue
      }

      const storiesData = await storiesRes.json()
      let processed = 0

      for (const story of storiesData.data || []) {
        const insights = await fetchStoryInsights(story.id, token)
        const publishedAt = story.timestamp ? new Date(story.timestamp) : new Date()
        const expiresAt = new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000)

        const { data: existing } = await supabase
          .from('content_pieces')
          .select('id')
          .eq('ig_media_id', story.id)
          .eq('client_id', client.id)
          .maybeSingle()

        const fields = {
          views: insights.views,
          reach: insights.reach,
          comments: insights.replies, // no dedicated "replies" column — closest existing fit
          total_interactions: insights.total_interactions,
          story_expires_at: expiresAt.toISOString(),
          metrics_source: 'meta_api' as const,
          metrics_updated_at: new Date().toISOString(),
        }

        if (existing) {
          await supabase
            .from('content_pieces')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        } else {
          await supabase.from('content_pieces').insert({
            client_id: client.id,
            content_type: 'story',
            ig_media_id: story.id,
            ig_permalink: story.permalink || null,
            published_at: story.timestamp || new Date().toISOString(),
            ...fields,
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
