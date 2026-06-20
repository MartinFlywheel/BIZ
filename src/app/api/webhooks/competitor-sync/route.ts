import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ReelPayload {
  ig_media_id?: string
  video_url?: string
  thumbnail_url?: string
  caption?: string
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  published_at?: string
}

interface SyncPayload {
  competitor_id: string
  reels: ReelPayload[]
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    const payload: SyncPayload = await request.json()

    if (!payload.competitor_id || !Array.isArray(payload.reels)) {
      return NextResponse.json({ error: 'Invalid payload: need competitor_id and reels[]' }, { status: 400 })
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('id, name')
      .eq('id', payload.competitor_id)
      .maybeSingle()

    if (!competitor) {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    let upserted = 0
    let skipped = 0

    for (const reel of payload.reels) {
      if (!reel.ig_media_id && !reel.video_url) {
        skipped++
        continue
      }

      const { error } = await supabase
        .from('competitor_reels')
        .upsert({
          competitor_id: payload.competitor_id,
          ig_media_id: reel.ig_media_id || `manual_${Date.now()}_${upserted}`,
          video_url: reel.video_url || null,
          thumbnail_url: reel.thumbnail_url || null,
          caption: reel.caption || null,
          views: reel.views || 0,
          likes: reel.likes || 0,
          comments: reel.comments || 0,
          shares: reel.shares || 0,
          saves: reel.saves || 0,
          published_at: reel.published_at || null,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'competitor_id,ig_media_id',
        })

      if (error) {
        console.error('[CompetitorSync] Upsert error:', error.message)
        skipped++
      } else {
        upserted++
      }
    }

    return NextResponse.json({
      status: 'ok',
      competitor: competitor.name,
      upserted,
      skipped,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
