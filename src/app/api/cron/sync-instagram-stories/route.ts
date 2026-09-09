import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Stories vanish 24h after posting, and Meta's API only exposes a story
// while it's still live — there's no historical lookup once it expires,
// unlike Reels/posts. vercel.json runs this once daily, every crons entry
// in this project is once-daily (likely a Vercel plan cap on cron
// frequency — worth confirming if this ever needs to run more often).
// Since that period matches the story lifespan, each story still lands
// inside exactly one run, just once, near the end of its life — no
// mid-life refresh, and no second chance if that one snapshot fails.
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

async function fetchStoryInsights(mediaId: string, token: string): Promise<{ insights: StoryInsights; error: string | null }> {
  const insights: StoryInsights = { views: 0, reach: 0, replies: 0, taps_forward: 0, taps_back: 0, exits: 0, total_interactions: 0 }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${mediaId}/insights?metric=${STORY_METRICS}&access_token=${token}`
    )
    if (res.ok) {
      const data = await res.json()
      for (const metric of data.data || []) {
        if (metric.name in insights) insights[metric.name as keyof StoryInsights] = metric.values?.[0]?.value || 0
      }
      return { insights, error: null }
    }
    // Graph API rejects the whole insights call if any one metric name in
    // STORY_METRICS is invalid/deprecated for this media type or API
    // version — same failure shape the reels sync hit with "impressions"
    // (see GENERAL_METRICS comment in sync-instagram/route.ts). Previously
    // this fell through silently and wrote zeros stamped as a successful
    // meta_api sync; log the real body so a bad metric name is diagnosable
    // instead of indistinguishable from "Instagram just has no data yet".
    const body = await res.text()
    const error = `HTTP ${res.status}: ${body.slice(0, 500)}`
    console.error(`[sync-instagram-stories] insights fetch failed for media ${mediaId}: ${error}`)
    return { insights, error }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[sync-instagram-stories] insights fetch threw for media ${mediaId}: ${error}`)
    return { insights, error }
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

  // Se apaga en la primera escritura que rebote por columna inexistente, para
  // no reintentar el mismo fallo una vez por historia.
  let storyColumnsMissing = false

  const { data: clients } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('status', 'active')
    .not('ig_account_id', 'is', null)

  if (!clients || clients.length === 0) {
    await logCronRun('sync-instagram-stories', { clientes: 0, motivo: 'sin clientes activos con Instagram conectado' })
    return NextResponse.json({ status: 'no_clients_with_ig' })
  }

  const results = []

  for (const client of clients) {
    try {
      const storiesRes = await fetch(
        `https://graph.facebook.com/${client.ig_account_id}/stories?fields=id,media_type,media_url,permalink,timestamp&access_token=${token}`
      )

      if (!storiesRes.ok) {
        results.push({ client: client.ig_handle, status: 'error', error: `API ${storiesRes.status}` })
        continue
      }

      const storiesData = await storiesRes.json()
      let processed = 0
      let insightErrors = 0
      let writeErrors = 0

      for (const story of storiesData.data || []) {
        const { insights, error } = await fetchStoryInsights(story.id, token)
        if (error) insightErrors++
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
          // Se mantiene igual a story_replies: los agregados que alimentan
          // los widgets de engagement siguen leyendo `comments` para todos
          // los tipos de contenido.
          comments: insights.replies,
          total_interactions: insights.total_interactions,
          story_expires_at: expiresAt.toISOString(),
          metrics_source: 'meta_api' as const,
          metrics_updated_at: new Date().toISOString(),
        }

        // Las agrega 056-metricas-historias.sql. Mientras esa migración no
        // se aplique las columnas no existen, así que la escritura se
        // reintenta sin ellas (Postgres 42703) en vez de fallar entera —
        // el mismo patrón de degradación que usa getClientTabCounts.
        const storyFields = storyColumnsMissing ? {} : {
          story_replies: insights.replies,
          story_taps_forward: insights.taps_forward,
          story_taps_back: insights.taps_back,
          story_exits: insights.exits,
        }

        const write = async (extra: Record<string, unknown>) =>
          existing
            ? supabase
                .from('content_pieces')
                .update({ ...fields, ...extra, updated_at: new Date().toISOString() })
                .eq('id', existing.id)
            : supabase.from('content_pieces').insert({
                client_id: client.id,
                content_type: 'story',
                ig_media_id: story.id,
                ig_permalink: story.permalink || null,
                ig_thumbnail_url: story.media_url || null,
                published_at: story.timestamp || new Date().toISOString(),
                ...fields,
                ...extra,
              })

        let { error: writeError } = await write(storyFields)
        if (writeError?.code === '42703') {
          storyColumnsMissing = true
          console.warn('[sync-instagram-stories] faltan las columnas story_*: aplica 056-metricas-historias.sql. Se guardan solo las métricas antiguas.')
          ;({ error: writeError } = await write({}))
        }
        if (writeError) {
          console.error(`[sync-instagram-stories] no se pudo guardar la historia ${story.id}: ${writeError.message}`)
          writeErrors++
        }

        processed++
      }

      results.push({ client: client.ig_handle, status: 'success', processed, insightErrors, writeErrors })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown'
      results.push({ client: client.ig_handle, status: 'error', error: msg })
    }
  }

  const fallidos = results.filter((r) => r.status === 'error')
  await logCronRun('sync-instagram-stories', {
    clientes: results.length,
    ok: results.length - fallidos.length,
    fallidos: fallidos.length,
    historias: results.reduce((n, r) => n + (r.processed ?? 0), 0),
    erroresDeInsights: results.reduce((n, r) => n + (r.insightErrors ?? 0), 0),
    erroresDeEscritura: results.reduce((n, r) => n + (r.writeErrors ?? 0), 0),
    columnasDeHistoriaFaltantes: storyColumnsMissing,
    errores: fallidos.map((r) => ({ cliente: r.client, error: r.error })),
  })

  return NextResponse.json({ results })
}
