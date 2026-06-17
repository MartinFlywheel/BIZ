import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Cron endpoint — must run at request time, never cached.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabaseAdmin = createAdminClient()
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: integrations } = await supabaseAdmin
    .from('integrations')
    .select('*, clients(id, ig_handle)')
    .eq('platform', 'instagram')
    .eq('status', 'connected')

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ status: 'no_integrations' })
  }

  const results = []

  for (const integration of integrations) {
    const { id: integrationId, access_token, client_id, token_expires_at } = integration

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      await supabaseAdmin
        .from('integrations')
        .update({ status: 'error', last_error: 'Token expired' })
        .eq('id', integrationId)
      results.push({ client_id, status: 'token_expired' })
      continue
    }

    await supabaseAdmin.from('sync_logs').insert({
      integration_id: integrationId,
      sync_type: 'content_fetch',
      status: 'started',
    })

    try {
      const mediaRes = await fetch(
        `https://graph.instagram.com/me/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&access_token=${access_token}`
      )

      if (!mediaRes.ok) {
        throw new Error(`Meta API error: ${mediaRes.status}`)
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
            `https://graph.instagram.com/${media.id}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${access_token}`
          )
          if (insightsRes.ok) {
            const insightsData = await insightsRes.json()
            for (const metric of insightsData.data || []) {
              insights[metric.name as keyof typeof insights] = metric.values?.[0]?.value || 0
            }
          }
        } catch { }

        const { data: existing } = await supabaseAdmin
          .from('content_pieces')
          .select('id')
          .eq('ig_media_id', media.id)
          .eq('client_id', client_id)
          .single()

        if (existing) {
          await supabaseAdmin
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
          await supabaseAdmin.from('content_pieces').insert({
            client_id,
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

      await supabaseAdmin.from('sync_logs').insert({
        integration_id: integrationId,
        sync_type: 'content_fetch',
        status: 'completed',
        records_processed: processed,
        completed_at: new Date().toISOString(),
      })

      await supabaseAdmin
        .from('integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', integrationId)

      results.push({ client_id, status: 'success', processed })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      await supabaseAdmin.from('sync_logs').insert({
        integration_id: integrationId,
        sync_type: 'content_fetch',
        status: 'failed',
        error: errorMsg,
        completed_at: new Date().toISOString(),
      })

      await supabaseAdmin
        .from('integrations')
        .update({ status: 'error', last_error: errorMsg })
        .eq('id', integrationId)

      results.push({ client_id, status: 'error', error: errorMsg })
    }
  }

  return NextResponse.json({ results })
}
