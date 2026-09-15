import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import {
  codigoPermalink,
  crearCupo,
  listarMediosDeCuenta,
  portadaParaEscribir,
  type MedioDeCuenta,
  type ResultadoPortada,
} from '@/lib/services/portadas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// "impressions" was deprecated April 21, 2025 — Meta merged
// impressions/plays/video_views into one universal "views" metric.
// Requesting the old name either 400s or silently returns nothing,
// which is why pieces kept syncing at 0.
const GENERAL_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions'

// /media se pagina hasta este tope por cliente. Antes era un solo limit=50:
// los reels más antiguos nunca se volvían a tocar, sus métricas quedaban
// congeladas y la portada caducaba.
const MAX_MEDIOS_POR_CLIENTE = 200

// Margen para no pasar los 60 s de Vercel: pasado este tiempo no se empieza
// otra tanda. La corrida siguiente vuelve a recorrer todo.
const PRESUPUESTO_MS = 48_000

function dayTypeKeys(contentType: string, isoTimestamp: string): string[] {
  const dayMs = new Date(`${isoTimestamp.slice(0, 10)}T00:00:00Z`).getTime()
  return [-1, 0, 1].map((offset) => `${contentType}|${new Date(dayMs + offset * 86400000).toISOString().slice(0, 10)}`)
}

function isRealInstagramPermalink(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'www.instagram.com' || host === 'instagram.com'
  } catch {
    return false
  }
}

// Clave para cruzar permalinks: el código corto, porque los enlaces pegados a
// mano traen ?utm_source=... y nunca coincidían con el de la API.
function permalinkKey(url: string): string {
  return codigoPermalink(url) ?? url
}

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

  const inicio = Date.now()
  const supabase = createAdminClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('status', 'active')
    .not('ig_account_id', 'is', null)

  if (!clients || clients.length === 0) {
    // Una corrida que no encontró nada igual es una corrida: sin esta fila no
    // hay forma de distinguir "no había clientes" de "el cron no se disparó".
    await logCronRun('sync-instagram', { clientes: 0, motivo: 'sin clientes activos con Instagram conectado' })
    return NextResponse.json({ status: 'no_clients_with_ig' })
  }

  // Un solo cupo de subidas para toda la corrida, repartido entre clientes.
  const cupo = crearCupo()
  const portadas: Record<Exclude<ResultadoPortada, null>, number> = { guardada: 0, fallida: 0, 'sin-cupo': 0 }
  let cortadoPorTiempo = false

  const results = []

  for (const client of clients) {
    if (Date.now() - inicio > PRESUPUESTO_MS) {
      cortadoPorTiempo = true
      results.push({ client: client.ig_handle, status: 'error', error: 'sin tiempo en esta corrida' })
      continue
    }
    try {
      const { medios, error: mediaError } = await listarMediosDeCuenta(client.ig_account_id, token, MAX_MEDIOS_POR_CLIENTE)

      if (mediaError) {
        results.push({ client: client.ig_handle, status: 'error', error: mediaError })
        continue
      }

      type Item = MedioDeCuenta
      // Meta's /media edge sometimes returns a reel twice: once as the real
      // post (permalink like instagram.com/reel/...) and once as its
      // underlying video asset — same timestamp, a different (longer) id,
      // and a permalink that's actually a raw signed CDN .mp4 URL, not a
      // real Instagram post. Drop those before matching/inserting, or they
      // become permanent garbage rows with no real content behind them.
      const items: Item[] = medios.filter((m) => !m.permalink || isRealInstagramPermalink(m.permalink))

      // Pieces created manually (tagged with a keyword_trigger, sometimes
      // carrying their own revenue via content_metrics) never got an
      // ig_media_id. Match them by permalink first, then by same day +
      // content_type, so the cron fills in real metrics on the existing
      // tagged row instead of creating an untagged duplicate that orphans
      // the revenue already logged against it.
      type ManualRow = { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null; caption: string | null }
      const [{ data: existingRows }, { data: unmatchedRows }] = await Promise.all([
        supabase
          .from('content_pieces')
          .select('id, ig_media_id, ig_thumbnail_url')
          .eq('client_id', client.id)
          .not('ig_media_id', 'is', null),
        supabase
          .from('content_pieces')
          .select('id, content_type, published_at, ig_permalink, ig_thumbnail_url, caption')
          .eq('client_id', client.id)
          .is('ig_media_id', null),
      ])

      const existingByMediaId = new Map(
        (existingRows || []).map((r) => [r.ig_media_id as string, { id: r.id as string, ig_thumbnail_url: r.ig_thumbnail_url as string | null }])
      )
      const byPermalink = new Map<string, ManualRow>()
      const byDayType = new Map<string, ManualRow[]>()
      for (const row of unmatchedRows || []) {
        if (row.ig_permalink) byPermalink.set(permalinkKey(row.ig_permalink), row)
        if (row.published_at) {
          const key = `${row.content_type}|${row.published_at.slice(0, 10)}`
          const arr = byDayType.get(key) ?? []
          arr.push(row)
          byDayType.set(key, arr)
        }
      }

      // Decide each item's match up front, synchronously, before any of the
      // slow API/DB work runs concurrently below — avoids two items racing
      // onto the same manual candidate.
      type Plan = { media: Item; contentType: string } & (
        | { kind: 'existing'; targetId: string; actual: string | null }
        | { kind: 'manual'; manualMatch: ManualRow }
        | { kind: 'new' }
      )
      const plans: Plan[] = items.map((media) => {
        const contentType = media.media_type === 'VIDEO' ? 'reel'
          : media.media_type === 'CAROUSEL_ALBUM' ? 'post'
          : 'post'

        const target = existingByMediaId.get(media.id)
        if (target) return { media, contentType, kind: 'existing', targetId: target.id, actual: target.ig_thumbnail_url }

        let manualMatch = (media.permalink && byPermalink.get(permalinkKey(media.permalink))) || null
        if (!manualMatch) {
          // Manual entries only carry a plain calendar date, but the real
          // post's UTC timestamp can land on the adjacent day depending on
          // what local hour it was actually published at — check a ±1 day
          // window, not just the exact date, before giving up.
          const keys = dayTypeKeys(contentType, media.timestamp)
          const candidates = keys.flatMap((k) => byDayType.get(k) ?? [])
          if (candidates.length === 1) manualMatch = candidates[0]
        }
        if (manualMatch) {
          if (manualMatch.ig_permalink) byPermalink.delete(permalinkKey(manualMatch.ig_permalink))
          for (const k of dayTypeKeys(contentType, media.timestamp)) {
            byDayType.set(k, (byDayType.get(k) ?? []).filter((c) => c.id !== manualMatch!.id))
          }
          return { media, contentType, kind: 'manual', manualMatch }
        }
        return { media, contentType, kind: 'new' }
      })

      // A Meta API round trip (or two, for reels) per item, run in small
      // concurrent batches instead of one at a time — sequential across
      // every client's full media list is what blew past Vercel's 60s
      // function cap on the Hobby plan.
      const CONCURRENCY = 8
      let processed = 0
      for (let i = 0; i < plans.length; i += CONCURRENCY) {
        if (Date.now() - inicio > PRESUPUESTO_MS) {
          cortadoPorTiempo = true
          break
        }
        const batch = plans.slice(i, i + CONCURRENCY)
        await Promise.all(batch.map(async (plan) => {
          const { media, contentType } = plan
          const actual = plan.kind === 'existing' ? plan.actual : plan.kind === 'manual' ? plan.manualMatch.ig_thumbnail_url : null
          const [insights, avgWatchTime, portada] = await Promise.all([
            fetchInsights(media.id, token),
            contentType === 'reel' ? fetchReelWatchTime(media.id, token) : Promise.resolve(null),
            // La portada se guarda en Storage en los tres caminos: antes solo
            // el insert escribía la URL del CDN y nunca se renovaba.
            portadaParaEscribir({ supabase, clientId: client.id, mediaId: media.id, actual, medio: media, cupo }),
          ])
          if (portada.resultado) portadas[portada.resultado]++
          const thumbnailField = portada.valor !== undefined ? { ig_thumbnail_url: portada.valor } : {}

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
              .update({ ...metricFields, ...thumbnailField, updated_at: new Date().toISOString() })
              .eq('id', plan.targetId)
          } else if (plan.kind === 'manual') {
            // Backfill ig_media_id so future syncs match directly — never
            // touch keyword_trigger, that's the team's own label. Caption is
            // different: pieces are usually created before the reel is
            // published/captioned, so the field is left blank at creation
            // time — only skip the real IG caption when the team actually
            // typed something into it themselves.
            await supabase
              .from('content_pieces')
              .update({
                ig_media_id: media.id,
                ...thumbnailField,
                ig_permalink: plan.manualMatch.ig_permalink ?? media.permalink,
                caption: plan.manualMatch.caption || media.caption,
                ...metricFields,
                updated_at: new Date().toISOString(),
              })
              .eq('id', plan.manualMatch.id)
          } else {
            await supabase.from('content_pieces').insert({
              client_id: client.id,
              content_type: contentType,
              ig_media_id: media.id,
              ig_permalink: media.permalink,
              ig_thumbnail_url: portada.valor ?? null,
              caption: media.caption,
              published_at: media.timestamp,
              ...metricFields,
            })
          }
        }))
        processed += batch.length
      }

      results.push({ client: client.ig_handle, status: 'success', processed, medios: plans.length })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown'
      results.push({ client: client.ig_handle, status: 'error', error: msg })
    }
  }

  const fallidos = results.filter((r) => r.status === 'error')
  await logCronRun('sync-instagram', {
    clientes: results.length,
    ok: results.length - fallidos.length,
    fallidos: fallidos.length,
    publicaciones: results.reduce((n, r) => n + (r.processed ?? 0), 0),
    portadasGuardadas: portadas.guardada,
    portadasFallidas: portadas.fallida,
    portadasPendientesPorCupo: portadas['sin-cupo'],
    cortadoPorTiempo,
    errores: fallidos.map((r) => ({ cliente: r.client, error: r.error })),
  })

  return NextResponse.json({ results, portadas, cortadoPorTiempo })
}
