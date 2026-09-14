import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { elegirPortada, esPortadaGuardada, esVideo, guardarPortada } from '@/lib/services/portadas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Las historias desaparecen 24 h después de publicarse y la API de Meta solo
// las entrega mientras siguen vivas: una vez vencidas no hay forma de pedir
// sus métricas ni su portada. pg_cron corre esta ruta cada 2 h (056), así que
// cada historia pasa por unas 11 corridas; en cada una se refrescan las
// métricas y, si todavía no tiene portada guardada, se intenta guardarla.
//
// taps_forward, taps_back y exits ya no existen en la API: pedirlos hacía que
// Meta rechazara la llamada completa y todas las historias quedaban en 0
// vistas. Los toques ahora salen de `navigation` con su desglose.
const STORY_METRICS = 'views,reach,replies,shares,total_interactions'

interface StoryInsights {
  views: number
  reach: number
  replies: number
  shares: number
  total_interactions: number
  taps_forward: number | null
  taps_back: number | null
  exits: number | null
}

interface MetricaMeta {
  name: string
  values?: { value?: number }[]
  total_value?: { value?: number }
}

async function fetchStoryInsights(mediaId: string, token: string): Promise<{ insights: StoryInsights | null; error: string | null }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${mediaId}/insights?metric=${STORY_METRICS}&access_token=${token}`
    )
    if (!res.ok) {
      // Meta rechaza la llamada entera si un solo nombre de métrica no es
      // válido. Se registra el cuerpo para poder diagnosticarlo y se devuelve
      // null: escribir ceros pisaría datos buenos como si fueran reales.
      const error = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
      console.error(`[sync-instagram-stories] insights fetch failed for media ${mediaId}: ${error}`)
      return { insights: null, error }
    }
    const data = await res.json()
    const valores: Record<string, number> = {}
    for (const metric of (data.data || []) as MetricaMeta[]) {
      valores[metric.name] = metric.values?.[0]?.value ?? metric.total_value?.value ?? 0
    }
    const insights: StoryInsights = {
      views: valores.views ?? 0,
      reach: valores.reach ?? 0,
      replies: valores.replies ?? 0,
      shares: valores.shares ?? 0,
      total_interactions: valores.total_interactions ?? 0,
      taps_forward: null,
      taps_back: null,
      exits: null,
    }

    // Los toques van en una segunda llamada: si falla, las vistas ya están.
    try {
      const nav = await fetch(
        `https://graph.facebook.com/${mediaId}/insights?metric=navigation&breakdown=story_navigation_action_type&access_token=${token}`
      )
      if (nav.ok) {
        const navData = await nav.json()
        const resultados: { dimension_values?: string[]; value?: number }[] =
          navData.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []
        const valor = (tipo: string) => resultados.find((r) => r.dimension_values?.[0] === tipo)?.value ?? 0
        insights.taps_forward = valor('tap_forward')
        insights.taps_back = valor('tap_back')
        insights.exits = valor('tap_exit')
      }
    } catch {
      // Sin el desglose de toques no se pierde nada más.
    }

    return { insights, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[sync-instagram-stories] insights fetch threw for media ${mediaId}: ${error}`)
    return { insights: null, error }
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

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('status', 'active')
    .not('ig_account_id', 'is', null)

  // Antes el error se ignoraba y quedaba registrado como "sin clientes".
  if (clientsError) {
    await logCronRun('sync-instagram-stories', { clientes: 0, error: `no se pudieron leer los clientes: ${clientsError.message}` })
    return NextResponse.json({ error: clientsError.message }, { status: 500 })
  }

  if (!clients || clients.length === 0) {
    await logCronRun('sync-instagram-stories', { clientes: 0, motivo: 'sin clientes activos con Instagram conectado' })
    return NextResponse.json({ status: 'no_clients_with_ig' })
  }

  const results = []
  let portadasGuardadas = 0
  let portadasFallidas = 0

  for (const client of clients) {
    try {
      const storiesRes = await fetch(
        `https://graph.facebook.com/${client.ig_account_id}/stories?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&access_token=${token}`
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
          .select('id, ig_thumbnail_url')
          .eq('ig_media_id', story.id)
          .eq('client_id', client.id)
          .maybeSingle()

        // La portada se guarda en Storage mientras la historia sigue viva. Si
        // la descarga falla, queda la URL del CDN como respaldo temporal y la
        // corrida siguiente lo vuelve a intentar. Un mp4 nunca se guarda como
        // portada: un <img> no lo puede mostrar.
        let portada: string | null | undefined
        if (!esPortadaGuardada(existing?.ig_thumbnail_url)) {
          const origen = elegirPortada(story)
          const guardada = await guardarPortada(supabase, client.id, story.id, origen)
          if (guardada) portadasGuardadas++
          else if (origen) portadasFallidas++
          if (guardada ?? origen) portada = guardada ?? origen
          else if (esVideo(existing?.ig_thumbnail_url)) portada = null
        }

        // Sin insights no se tocan las métricas: antes se escribían ceros con
        // metrics_source='meta_api' y tapaban cualquier dato bueno.
        const fields: Record<string, unknown> = {
          story_expires_at: expiresAt.toISOString(),
          ...(portada !== undefined && { ig_thumbnail_url: portada }),
          ...(insights && {
            views: insights.views,
            reach: insights.reach,
            // Se mantiene igual a story_replies: los agregados que alimentan
            // los widgets de engagement siguen leyendo `comments` para todos
            // los tipos de contenido.
            comments: insights.replies,
            shares: insights.shares,
            total_interactions: insights.total_interactions,
            metrics_source: 'meta_api',
            metrics_updated_at: new Date().toISOString(),
          }),
        }

        // Las agrega 056-metricas-historias.sql. Mientras esa migración no
        // se aplique las columnas no existen, así que la escritura se
        // reintenta sin ellas (Postgres 42703) en vez de fallar entera —
        // el mismo patrón de degradación que usa getClientTabCounts.
        const storyFields: Record<string, unknown> = storyColumnsMissing || !insights ? {} : {
          story_replies: insights.replies,
          ...(insights.taps_forward !== null && {
            story_taps_forward: insights.taps_forward,
            story_taps_back: insights.taps_back,
            story_exits: insights.exits,
          }),
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
                published_at: story.timestamp || new Date().toISOString(),
                metrics_source: 'meta_api',
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
    portadasGuardadas,
    portadasFallidas,
    columnasDeHistoriaFaltantes: storyColumnsMissing,
    errores: fallidos.map((r) => ({ cliente: r.client, error: r.error })),
  })

  return NextResponse.json({ results })
}
