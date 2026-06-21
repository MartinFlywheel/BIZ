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
  client_id: string
  reels: ReelPayload[]
}

async function uploadThumbnail(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  mediaId: string,
  thumbnailUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(thumbnailUrl, { redirect: 'follow' })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const buffer = await res.arrayBuffer()

    const path = `clients/${clientId}/${mediaId}.${ext}`

    const { error } = await supabase.storage
      .from('thumbnails')
      .upload(path, buffer, { contentType, upsert: true })

    if (error) return null

    const { data: urlData } = supabase.storage
      .from('thumbnails')
      .getPublicUrl(path)

    return urlData.publicUrl
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    const payload: SyncPayload = await request.json()

    if (!payload.client_id || !Array.isArray(payload.reels)) {
      return NextResponse.json({ error: 'Need client_id and reels[]' }, { status: 400 })
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', payload.client_id)
      .maybeSingle()

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    let inserted = 0
    let updated = 0

    for (const reel of payload.reels) {
      if (!reel.ig_media_id && !reel.video_url) continue

      const mediaId = reel.ig_media_id || `ext_${Date.now()}_${inserted}`

      let permanentUrl: string | null = null
      if (reel.thumbnail_url) {
        permanentUrl = await uploadThumbnail(supabase, payload.client_id, mediaId, reel.thumbnail_url)
      }

      const contentType = 'reel'

      const { data: existing } = await supabase
        .from('content_pieces')
        .select('id')
        .eq('ig_media_id', mediaId)
        .eq('client_id', payload.client_id)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('content_pieces')
          .update({
            ig_thumbnail_url: permanentUrl || reel.thumbnail_url || null,
            caption: reel.caption || null,
            views: reel.views || 0,
            likes: reel.likes || 0,
            comments: reel.comments || 0,
            shares: reel.shares || 0,
            saves: reel.saves || 0,
            metrics_source: 'meta_api',
            metrics_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        updated++
      } else {
        await supabase.from('content_pieces').insert({
          client_id: payload.client_id,
          content_type: contentType,
          ig_media_id: mediaId,
          ig_permalink: reel.video_url || null,
          ig_thumbnail_url: permanentUrl || reel.thumbnail_url || null,
          caption: reel.caption || null,
          published_at: reel.published_at || null,
          views: reel.views || 0,
          likes: reel.likes || 0,
          comments: reel.comments || 0,
          shares: reel.shares || 0,
          saves: reel.saves || 0,
          metrics_source: 'meta_api',
          metrics_updated_at: new Date().toISOString(),
        })
        inserted++
      }
    }

    return NextResponse.json({
      status: 'ok',
      client: client.name,
      inserted,
      updated,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
