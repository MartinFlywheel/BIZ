import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
        `https://graph.instagram.com/${client.ig_account_id}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&access_token=${token}&limit=50`
      )

      if (!mediaRes.ok) {
        results.push({ client: client.ig_handle, status: 'error', error: `API ${mediaRes.status}` })
        continue
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
          .eq('client_id', client.id)
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
            client_id: client.id,
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

      results.push({ client: client.ig_handle, status: 'success', processed })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown'
      results.push({ client: client.ig_handle, status: 'error', error: msg })
    }
  }

  return NextResponse.json({ results })
}
