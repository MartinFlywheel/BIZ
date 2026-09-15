import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { crearCupo, esPortadaGuardada, esVideo, guardarPortada } from '@/lib/services/portadas'

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
  shortCode?: string
}

// Apify's instagram-reel-scraper sometimes returns facebook.com URLs.
// Prefer instagram.com; if only a shortCode is available, build the URL.
function sanitizeIgPermalink(videoUrl: string | undefined, shortCode: string | undefined): string | null {
  if (videoUrl && videoUrl.includes('instagram.com')) return videoUrl
  if (shortCode) return `https://www.instagram.com/reel/${shortCode}/`
  return null
}

interface SyncPayload {
  client_id: string
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
    let portadasGuardadas = 0
    // Tope de subidas por llamada para no pasar los 60 s; lo que quede con la
    // URL del CDN lo guarda la llamada siguiente o el cron diario.
    const cupo = crearCupo()

    for (const reel of payload.reels) {
      if (!reel.ig_media_id && !reel.video_url) continue

      const mediaId = reel.ig_media_id || `ext_${Date.now()}_${inserted}`
      // Apify a veces trae el video en thumbnail_url: un mp4 no es portada.
      const origen = reel.thumbnail_url && !esVideo(reel.thumbnail_url) ? reel.thumbnail_url : null

      const contentType = 'reel'

      const { data: existing } = await supabase
        .from('content_pieces')
        .select('id, ig_thumbnail_url')
        .eq('ig_media_id', mediaId)
        .eq('client_id', payload.client_id)
        .maybeSingle()

      // Una portada ya guardada en Storage no se vuelve a subir ni se pisa.
      const yaGuardada = esPortadaGuardada(existing?.ig_thumbnail_url)
      let portada: string | null = null
      if (!yaGuardada && origen) {
        if (cupo.restantes > 0) {
          cupo.restantes--
          portada = await guardarPortada(supabase, payload.client_id, mediaId, origen)
          if (portada) portadasGuardadas++
        }
        portada ??= origen
      }

      if (existing) {
        const sanitizedPermalink = sanitizeIgPermalink(reel.video_url, reel.shortCode)
        await supabase
          .from('content_pieces')
          .update({
            // Sin portada nueva no se toca la columna: antes se escribía NULL
            // encima de la que hubiera.
            ...(portada && { ig_thumbnail_url: portada }),
            ...(sanitizedPermalink && { ig_permalink: sanitizedPermalink }),
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
          ig_permalink: sanitizeIgPermalink(reel.video_url, reel.shortCode),
          ig_thumbnail_url: portada,
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
      thumbnails_uploaded: portadasGuardadas,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
