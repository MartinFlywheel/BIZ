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
  mode?: 'replace' | 'upsert'
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
      return NextResponse.json(
        { error: 'Invalid payload: need competitor_id and reels[]' },
        { status: 400 }
      )
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('id, name')
      .eq('id', payload.competitor_id)
      .maybeSingle()

    if (!competitor) {
      return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
    }

    const mode = payload.mode || 'replace'

    // Replace mode: wipe old reels, insert fresh batch
    if (mode === 'replace') {
      const { error: deleteError } = await supabase
        .from('competitor_reels')
        .delete()
        .eq('competitor_id', payload.competitor_id)

      if (deleteError) {
        console.error('[CompetitorSync] Delete error:', deleteError.message)
      }
    }

    let inserted = 0
    let skipped = 0
    const now = new Date().toISOString()

    const rows = payload.reels
      .filter((r) => r.ig_media_id || r.video_url)
      .map((reel, i) => ({
        competitor_id: payload.competitor_id,
        ig_media_id: reel.ig_media_id || `ext_${Date.now()}_${i}`,
        video_url: reel.video_url || null,
        thumbnail_url: reel.thumbnail_url || null,
        caption: reel.caption || null,
        views: reel.views || 0,
        likes: reel.likes || 0,
        comments: reel.comments || 0,
        shares: reel.shares || 0,
        saves: reel.saves || 0,
        published_at: reel.published_at || null,
        synced_at: now,
      }))

    skipped = payload.reels.length - rows.length

    if (rows.length > 0) {
      if (mode === 'replace') {
        const { error } = await supabase
          .from('competitor_reels')
          .insert(rows)

        if (error) {
          console.error('[CompetitorSync] Insert error:', error.message)
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        inserted = rows.length
      } else {
        for (const row of rows) {
          const { error } = await supabase
            .from('competitor_reels')
            .upsert(row, { onConflict: 'competitor_id,ig_media_id' })

          if (error) {
            skipped++
          } else {
            inserted++
          }
        }
      }
    }

    return NextResponse.json({
      status: 'ok',
      mode,
      competitor: competitor.name,
      inserted,
      skipped,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
