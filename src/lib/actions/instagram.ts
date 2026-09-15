'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getAppUrl } from '@/lib/env'
import {
  codigoPermalink,
  crearCupo,
  listarMediosDeCuenta,
  portadaParaEscribir,
  type CupoPortadas,
  type MedioDeCuenta,
} from '@/lib/services/portadas'

export async function linkInstagramAccount(clientId: string, igAccountId: string) {
  const supabase = await createClient()

  const cleanId = igAccountId.trim()
  if (!cleanId) throw new Error('Instagram Account ID is required')

  const { error } = await supabase
    .from('clients')
    .update({
      ig_account_id: cleanId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
}

export async function unlinkInstagramAccount(clientId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({
      ig_account_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
}

// =====================================================
// Sync Content — pull from Instagram Graph API
// Fetches media_url (images) AND thumbnail_url (videos)
// =====================================================

type MediaItem = MedioDeCuenta

// Mismo tope que el cron diario: suficiente para que los reels antiguos
// también se actualicen, sin que el botón pase del límite de tiempo.
const MAX_MEDIOS = 200

// El botón corre como server action y comparte el límite de 60 s de Vercel.
// Pasado este margen no se empieza otra tanda y el mensaje lo dice.
const PRESUPUESTO_MS = 45_000

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

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
type SupabaseAdminClient = ReturnType<typeof createAdminClient>

type ManualRow = { id: string; ig_thumbnail_url: string | null; ig_permalink: string | null; caption: string | null }

// Fetches this one item's insights (and reel watch time) and writes the
// result — the unit of work that used to run one-at-a-time in a for loop.
async function processPlan(
  supabase: SupabaseServerClient,
  // Solo para Storage: el bucket de portadas no tiene política de UPDATE y
  // un upsert con la sesión del usuario falla sin avisar. Las escrituras en
  // content_pieces siguen yendo con la sesión, bajo RLS.
  storage: SupabaseAdminClient,
  cupo: CupoPortadas,
  clientId: string,
  token: string,
  plan: { media: MediaItem; contentType: string } & (
    | { kind: 'existing'; targetId: string; actual: string | null }
    | { kind: 'manual'; manualMatch: ManualRow }
    | { kind: 'new' }
  )
): Promise<void> {
  const { media, contentType } = plan
  const actual = plan.kind === 'existing' ? plan.actual : plan.kind === 'manual' ? plan.manualMatch.ig_thumbnail_url : null

  const insights = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0, total_interactions: 0 }
  const [insightsResult, watchTimeResult, portada] = await Promise.all([
    (async () => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/${media.id}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions&access_token=${token}`
        )
        if (res.ok) return (await res.json()).data as { name: string; values?: { value: number }[] }[]
      } catch {}
      return null
    })(),
    contentType === 'reel'
      ? (async () => {
          try {
            const res = await fetch(
              `https://graph.facebook.com/${media.id}/insights?metric=ig_reels_avg_watch_time&access_token=${token}`
            )
            if (res.ok) {
              const ms = (await res.json()).data?.[0]?.values?.[0]?.value
              if (typeof ms === 'number') return Math.round(ms / 1000)
            }
          } catch {}
          return null
        })()
      : Promise.resolve(null),
    // Antes la rama existing escribía la URL del CDN sin condición: pisaba
    // una portada ya guardada en Storage y podía dejar NULL.
    portadaParaEscribir({ supabase: storage, clientId, mediaId: media.id, actual, medio: media, cupo }),
  ])

  for (const metric of insightsResult || []) {
    if (metric.name in insights) insights[metric.name as keyof typeof insights] = metric.values?.[0]?.value || 0
  }
  const avgWatchTime = watchTimeResult
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
      .update({
        ...thumbnailField,
        ig_permalink: media.permalink,
        caption: media.caption,
        ...metricFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.targetId)
  } else if (plan.kind === 'manual') {
    // Backfill ig_media_id so future syncs match directly — never touch
    // keyword_trigger, that's the team's own label. Caption is different:
    // pieces are usually created before the reel is published/captioned,
    // so the field is left blank at creation time — only skip the real IG
    // caption when the team actually typed something into it themselves.
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
      client_id: clientId,
      content_type: contentType,
      ig_media_id: media.id,
      ig_permalink: media.permalink,
      ig_thumbnail_url: portada.valor ?? null,
      caption: media.caption,
      published_at: media.timestamp,
      ...metricFields,
    })
  }
}

export async function syncClientContent(clientId: string): Promise<{
  status: 'success' | 'error'
  processed: number
  message: string
}> {
  const inicio = Date.now()
  const supabase = await createClient()
  const token = process.env.META_SYSTEM_USER_TOKEN

  if (!token) {
    return { status: 'error', processed: 0, message: 'META_SYSTEM_USER_TOKEN not configured' }
  }

  // Se lee con la sesión del usuario: si la RLS no le deja ver este cliente,
  // no llega a usarse el cliente admin para nada.
  const { data: client } = await supabase
    .from('clients')
    .select('id, ig_account_id, ig_handle')
    .eq('id', clientId)
    .single()

  if (!client?.ig_account_id) {
    return { status: 'error', processed: 0, message: 'Client has no Instagram Account ID linked' }
  }

  try {
    const { medios, error: mediaError } = await listarMediosDeCuenta(client.ig_account_id, token, MAX_MEDIOS)

    if (mediaError) {
      return { status: 'error', processed: 0, message: `Instagram API error: ${mediaError}` }
    }

    // Meta's /media edge sometimes returns a reel twice: once as the real
    // post (permalink like instagram.com/reel/...) and once as its
    // underlying video asset — same timestamp, a different (longer) id, and
    // a permalink that's actually a raw signed CDN .mp4 URL, not a real
    // Instagram post. Drop those before matching/inserting, or they become
    // permanent garbage rows with no real content behind them.
    const items: MediaItem[] = medios.filter((m) => !m.permalink || isRealInstagramPermalink(m.permalink))

    // Pieces created manually (tagged with a keyword_trigger, sometimes
    // carrying their own revenue via content_metrics) never got an
    // ig_media_id — the API has no way to know they're the same post. Match
    // them by permalink first, then by same day + content_type, so the sync
    // fills in real metrics on the existing tagged row instead of creating
    // an untagged duplicate that orphans the revenue already logged against it.
    const [{ data: existingRows }, { data: unmatchedRows }] = await Promise.all([
      supabase
        .from('content_pieces')
        .select('id, ig_media_id, ig_thumbnail_url')
        .eq('client_id', clientId)
        .not('ig_media_id', 'is', null),
      supabase
        .from('content_pieces')
        .select('id, content_type, published_at, ig_permalink, ig_thumbnail_url, caption')
        .eq('client_id', clientId)
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

    // Decide each item's match up front, synchronously — this is where the
    // manual-match maps get mutated, so running the slow API/DB work below
    // concurrently can't race two items onto the same manual candidate.
    type Plan = { media: MediaItem; contentType: string } & (
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

    // The slow part — a Meta API round trip (or two, for reels) per item —
    // runs in small concurrent batches instead of one item at a time.
    // Sequential was the reason a client with 30+ posts blew past Vercel's
    // 60s function cap on the Hobby plan; this account alone timed out
    // clicking "Sincronizar" once already.
    const storage = createAdminClient()
    const cupo = crearCupo()
    const CONCURRENCY = 8
    let processed = 0
    let cortado = false
    for (let i = 0; i < plans.length; i += CONCURRENCY) {
      if (Date.now() - inicio > PRESUPUESTO_MS) {
        cortado = true
        break
      }
      const batch = plans.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map((plan) => processPlan(supabase, storage, cupo, clientId, token, plan)))
      processed += batch.length
    }

    revalidatePath(`/clients/${clientId}`)
    revalidatePath('/content')

    const message = cortado
      ? `${processed} de ${plans.length} contenidos sincronizados; se detuvo por tiempo, el cron diario completa el resto`
      : `${processed} contenidos sincronizados`
    return { status: 'success', processed, message }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', processed: 0, message: msg }
  }
}

// =====================================================
// Quick Add Latest Reels — triggers n8n to scrape via Apify
// Same pipeline as competitors, no API token needed
// =====================================================

export async function quickAddLatestReels(clientId: string, limit = 10): Promise<{
  status: 'success' | 'error'
  added: number
  skipped: number
  message: string
}> {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, ig_handle, name')
    .eq('id', clientId)
    .single()

  if (!client?.ig_handle) {
    return { status: 'error', added: 0, skipped: 0, message: 'El cliente no tiene handle de Instagram' }
  }

  const n8nUrl = process.env.N8N_COMPETITOR_SYNC_URL
  if (!n8nUrl) {
    return { status: 'error', added: 0, skipped: 0, message: 'N8N_COMPETITOR_SYNC_URL not configured' }
  }

  const igHandle = client.ig_handle.replace(/^@/, '')

  try {
    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        target: 'client',
        ig_handle: igHandle,
        instagram_profile_url: `https://www.instagram.com/${igHandle}/`,
        callback_url: `${getAppUrl()}/api/webhooks/client-content-sync`,
      }),
    })

    if (!res.ok) {
      return { status: 'error', added: 0, skipped: 0, message: `n8n error: ${res.status}` }
    }

    return {
      status: 'success',
      added: 0,
      skipped: 0,
      message: 'Sincronización iniciada — los reels aparecerán en unos segundos',
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', added: 0, skipped: 0, message: msg }
  }
}
