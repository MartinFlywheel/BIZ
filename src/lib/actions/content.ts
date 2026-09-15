'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { ContentType } from '@/lib/types'
import { fetchAllRows, fetchAllRowsByCursor } from '@/lib/supabase/paginate'
import { getContentAnalytics } from './content-analytics'
import { getClientFunnelTotals } from './metrics'
import {
  elegirPortada,
  esCdnMeta,
  esPortadaGuardada,
  guardarPortada,
  idPortadaManual,
} from '@/lib/services/portadas'

export async function getContentPieces(clientId?: string) {
  const supabase = await createClient()

  return fetchAllRows((from, to) => {
    let query = supabase
      .from('content_pieces')
      .select('*, clients(name, ig_handle), campaigns(name)')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (clientId) query = query.eq('client_id', clientId)
    return query
  })
}

export async function getContentPiecesCount(clientId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('content_pieces')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if (error) throw error
  return count ?? 0
}

// Every ManyChat webhook resolves its client by matching keyword_trigger
// alone (case-insensitive, no client scoping — the incoming URL only
// carries the piece code, nothing that identifies the client). Two
// clients sharing a code silently misattributes leads to the wrong one,
// so this has to be caught before it's saved, not after — the DB-level
// unique index (034-unique-keyword-trigger.sql) is the backstop, but a
// raw constraint-violation message isn't a useful thing to show someone
// filling out this form.
async function assertKeywordTriggerAvailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  keywordTrigger: string | null,
  excludeId?: string
): Promise<string | null> {
  if (!keywordTrigger) return null

  let query = supabase
    .from('content_pieces')
    .select('id, client_id, clients(name)')
    .ilike('keyword_trigger', keywordTrigger)
    .limit(1)

  if (excludeId) query = query.neq('id', excludeId)

  const { data: clash } = await query.maybeSingle()
  if (!clash) return null

  const clientName = (clash as { clients?: { name?: string } | null }).clients?.name || 'otro cliente'
  return `El código "${keywordTrigger}" ya está en uso por una pieza de ${clientName}. Los códigos deben ser únicos en todo el sistema — ManyChat solo identifica la pieza por este código, sin saber a qué cliente pertenece.`
}

export async function createContentAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string
  const igPermalink = (formData.get('ig_permalink') as string) || null
  const keywordTrigger = (formData.get('keyword_trigger') as string) || null

  const clashError = await assertKeywordTriggerAvailable(supabase, keywordTrigger)
  if (clashError) return { success: false as const, error: clashError }

  const manualThumbnail = (formData.get('ig_thumbnail_url') as string) || null
  let thumbnailUrl: string | null = manualThumbnail
  if (!thumbnailUrl && igPermalink) {
    thumbnailUrl = await extractIgThumbnail(igPermalink)
  }

  // El id se genera aquí para poder nombrar la portada en Storage sin tener
  // que releer la fila después del insert.
  const pieceId = crypto.randomUUID()
  const { error } = await supabase.from('content_pieces').insert({
    id: pieceId,
    client_id: clientId,
    campaign_id: (formData.get('campaign_id') as string) || null,
    content_type: formData.get('content_type') as ContentType,
    caption: (formData.get('caption') as string) || null,
    hook: (formData.get('hook') as string) || null,
    keyword_trigger: keywordTrigger,
    published_at: (formData.get('published_at') as string) || null,
    views: parseInt(formData.get('views') as string) || 0,
    likes: parseInt(formData.get('likes') as string) || 0,
    comments: parseInt(formData.get('comments') as string) || 0,
    shares: parseInt(formData.get('shares') as string) || 0,
    saves: parseInt(formData.get('saves') as string) || 0,
    reach: parseInt(formData.get('reach') as string) || 0,
    ig_permalink: igPermalink,
    ig_thumbnail_url: thumbnailUrl,
    metrics_source: 'manual',
    metrics_updated_at: new Date().toISOString(),
  })

  if (error) return { success: false as const, error: error.message }
  // Solo después de que el insert pasó la RLS: así el cliente admin nunca se
  // usa para alguien sin permiso sobre este cliente.
  await guardarPortadaPegada(supabase, pieceId, clientId, thumbnailUrl)
  try { revalidatePath('/content'); revalidatePath(`/clients/${clientId}`) } catch {}
  return { success: true as const }
}

/**
 * Pasa a Storage una portada del CDN de Meta (pegada a mano o sacada del
 * oEmbed), que de otro modo caduca en pocos días. Solo toca URLs de Meta: una
 * imagen de otro sitio queda tal cual y el servidor no descarga URLs
 * arbitrarias que lleguen en un formulario. Si falla, la pieza se queda con la
 * URL original; nunca bloquea el guardado.
 */
async function guardarPortadaPegada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pieceId: string,
  clientId: string,
  url: string | null
): Promise<void> {
  if (!url || !esCdnMeta(url)) return
  const guardada = await guardarPortada(createAdminClient(), clientId, idPortadaManual(pieceId, url), url)
  if (!guardada) return
  await supabase.from('content_pieces').update({ ig_thumbnail_url: guardada }).eq('id', pieceId)
}

async function extractIgThumbnail(permalink: string): Promise<string | null> {
  // Method 1: Facebook oEmbed API (app token)
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (appId && appSecret) {
    try {
      const params = new URLSearchParams({
        url: permalink,
        access_token: `${appId}|${appSecret}`,
        fields: 'thumbnail_url',
      })
      const res = await fetch(
        `https://graph.facebook.com/v19.0/instagram_oembed?${params.toString()}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.thumbnail_url) return data.thumbnail_url
      }
    } catch { }
  }

  // Method 2: Instagram Graph API via system token — same host/path as
  // Method 1's oEmbed call, not graph.instagram.com (that host doesn't
  // parse Business Manager System User tokens at all, see syncClientContent).
  const systemToken = process.env.META_SYSTEM_USER_TOKEN
  if (systemToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(permalink)}&access_token=${systemToken}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.thumbnail_url) return data.thumbnail_url
      }
    } catch { }
  }

  return null
}

export async function updateContentAction(id: string, clientId: string, formData: FormData) {
  const supabase = await createClient()
  const keywordTrigger = (formData.get('keyword_trigger') as string) || null

  const clashError = await assertKeywordTriggerAvailable(supabase, keywordTrigger, id)
  if (clashError) return { success: false as const, error: clashError }

  // Vaciar el campo de portada no borra una portada ya guardada en Storage:
  // esa copia suele ser lo único que queda cuando la URL del CDN caducó (en
  // una historia vencida no hay forma de volver a pedirla). Para cambiarla se
  // pega otra URL.
  const thumbnailInput = (formData.get('ig_thumbnail_url') as string) || null
  let conservarPortada = false
  if (!thumbnailInput) {
    const { data: actual } = await supabase
      .from('content_pieces')
      .select('ig_thumbnail_url')
      .eq('id', id)
      .maybeSingle()
    conservarPortada = esPortadaGuardada(actual?.ig_thumbnail_url)
  }

  // Deliberately excludes views/likes/comments/shares/saves/reach/metrics_source:
  // pieces synced from Instagram (metrics_source 'meta_api') own those via the
  // sync cron — editing metadata here must not zero them out.
  const { error } = await supabase
    .from('content_pieces')
    .update({
      campaign_id: (formData.get('campaign_id') as string) || null,
      content_type: formData.get('content_type') as ContentType,
      caption: (formData.get('caption') as string) || null,
      hook: (formData.get('hook') as string) || null,
      keyword_trigger: keywordTrigger,
      ig_permalink: (formData.get('ig_permalink') as string) || null,
      ...(!conservarPortada && { ig_thumbnail_url: thumbnailInput }),
      published_at: (formData.get('published_at') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { success: false as const, error: error.message }
  await guardarPortadaPegada(supabase, id, clientId, thumbnailInput)
  try { revalidatePath('/content'); revalidatePath(`/clients/${clientId}`) } catch {}
  return { success: true as const }
}

export async function deleteContentAction(id: string, clientId: string) {
  const supabase = await createClient()

  await supabase.from('content_metrics').delete().eq('content_id', id)
  await supabase.from('content_notes').delete().eq('content_id', id)

  const { error } = await supabase.from('content_pieces').delete().eq('id', id)
  if (error) throw error

  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
}

export async function upsertContentMetrics(contentId: string, clientId: string, formData: FormData) {
  const supabase = await createClient()

  const payload = {
    content_id: contentId,
    client_id: clientId,
    chats_nuevos: parseInt(formData.get('chats_nuevos') as string) || 0,
    conversaciones_nuevas: parseInt(formData.get('conversaciones') as string) || 0,
    agendas: parseInt(formData.get('agendas') as string) || 0,
    shows: parseInt(formData.get('shows') as string) || 0,
    cierres: parseInt(formData.get('cierres') as string) || 0,
    ticket: formData.get('ticket') ? parseFloat(formData.get('ticket') as string) : null,
    aov: formData.get('aov') ? parseFloat(formData.get('aov') as string) : null,
    cash_collected: formData.get('cash_collected') ? parseFloat(formData.get('cash_collected') as string) : null,
    manychat_label: (formData.get('manychat_label') as string) || null,
    notes: (formData.get('notes') as string) || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('content_metrics')
    .upsert(payload, { onConflict: 'content_id' })

  if (error) throw error
  revalidatePath('/content')
  revalidatePath(`/clients/${clientId}`)
}

export async function getContentMetricsByClient(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_metrics')
    .select('*')
    .eq('client_id', clientId)

  if (error) throw error
  return data
}

/** Chats y conversaciones de una pieza, de por vida (igual que sus vistas). */
export interface ConteoInteraccionesPieza {
  content_id: string
  chats: number
  conversaciones: number
  // Ninguna fila de la pieza muestra que el nodo chat-abierto de ManyChat se
  // haya disparado: todas sus conversaciones entraron en una sola llamada
  // (bot_triggered_at === prospect_responded_at) y no hay ningún chat_abierto.
  // Lo usa la tabla "Chats → Conversaciones por Pieza".
  sin_nodo_chat_abierto: boolean
}

const CLASIFICACIONES_CONVERSACION = ['conversacion_real', 'lead_calificado']

type FilaConteo = {
  id: string
  content_id: string | null
  classification: string
  bot_triggered_at?: string | null
  prospect_responded_at?: string | null
}

/**
 * Conteo de interactions por pieza para la pestaña Contenido. Antes el grid
 * bajaba la tabla entera (17 mil filas, unos 13 MB con los joins) solo para
 * contar. Usa la función de 072; si todavía no se aplicó, cae a leer solo las
 * columnas necesarias y agrupar aquí.
 */
async function getInteractionCountsByPiece(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string
): Promise<ConteoInteraccionesPieza[]> {
  const { data, error } = await supabase.rpc('interaction_counts_by_piece', { p_client_id: clientId })

  if (!error) {
    const filas = ((data ?? []) as { content_id: string; chats: number | string; conversaciones: number | string }[])
      .map((r) => ({ content_id: r.content_id, chats: Number(r.chats), conversaciones: Number(r.conversaciones) }))
    return marcarSinNodoChatAbierto(supabase, clientId, filas)
  }

  if (error.code !== '42883' && error.code !== 'PGRST202') {
    console.error('[getContentTabData] interaction_counts_by_piece falló, se cuenta en memoria:', error.message)
  }

  const filas = await fetchAllRowsByCursor<FilaConteo>((cursor, limit) => {
    let query = supabase
      .from('interactions')
      .select('id, content_id, classification, bot_triggered_at, prospect_responded_at')
      .eq('client_id', clientId)
      .not('content_id', 'is', null)
      .order('id', { ascending: true })
      .limit(limit)
    if (cursor) query = query.gt('id', cursor)
    return query
  })

  // Misma regla que tenía la tabla del grid: cuenta como evidencia del nodo
  // chat-abierto un chat_abierto, o una conversación cuyo bot_triggered_at y
  // prospect_responded_at difieren (se promovió en dos llamadas).
  const conteos = new Map<string, { chats: number; conversaciones: number; evidencia: number }>()
  for (const i of filas) {
    if (!i.content_id) continue
    const c = conteos.get(i.content_id) ?? { chats: 0, conversaciones: 0, evidencia: 0 }
    c.chats += 1
    if (i.classification === 'chat_abierto') {
      c.evidencia += 1
    } else if (CLASIFICACIONES_CONVERSACION.includes(i.classification)) {
      c.conversaciones += 1
      if (i.prospect_responded_at !== i.bot_triggered_at) c.evidencia += 1
    }
    conteos.set(i.content_id, c)
  }
  return Array.from(conteos, ([content_id, c]) => ({
    content_id,
    chats: c.chats,
    conversaciones: c.conversaciones,
    sin_nodo_chat_abierto: c.conversaciones > 0 && c.evidencia === 0,
  }))
}

/**
 * La función SQL solo devuelve chats y conversaciones. El aviso "sin nodo
 * chat-abierto" se resuelve sin volver a bajar la tabla: en una pieza con
 * conversaciones, si quedan chats que no son conversación ni 'disqualified',
 * son chat_abierto y ya hay evidencia. Solo en las piezas donde todo es
 * conversación (2 de 38 en Mane) hace falta mirar los timestamps.
 */
async function marcarSinNodoChatAbierto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  filas: { content_id: string; chats: number; conversaciones: number }[]
): Promise<ConteoInteraccionesPieza[]> {
  const resultado = filas.map((f) => ({ ...f, sin_nodo_chat_abierto: false }))
  const conConversaciones = resultado.filter((f) => f.conversaciones > 0)
  if (conConversaciones.length === 0) return resultado

  try {
    const descalificadas = await fetchAllRowsByCursor<{ id: string; content_id: string | null }>((cursor, limit) => {
      let query = supabase
        .from('interactions')
        .select('id, content_id')
        .eq('client_id', clientId)
        .eq('classification', 'disqualified')
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) query = query.gt('id', cursor)
      return query
    })
    const descalificadasPorPieza = new Map<string, number>()
    for (const d of descalificadas) {
      if (d.content_id) descalificadasPorPieza.set(d.content_id, (descalificadasPorPieza.get(d.content_id) ?? 0) + 1)
    }

    const porRevisar = conConversaciones.filter(
      (f) => f.chats - f.conversaciones - (descalificadasPorPieza.get(f.content_id) ?? 0) === 0
    )
    if (porRevisar.length === 0) return resultado

    const conversaciones = await fetchAllRowsByCursor<FilaConteo>((cursor, limit) => {
      let query = supabase
        .from('interactions')
        .select('id, content_id, classification, bot_triggered_at, prospect_responded_at')
        .eq('client_id', clientId)
        .in('content_id', porRevisar.map((f) => f.content_id))
        .in('classification', CLASIFICACIONES_CONVERSACION)
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) query = query.gt('id', cursor)
      return query
    })
    const conEvidencia = new Set(
      conversaciones.filter((i) => i.content_id && i.prospect_responded_at !== i.bot_triggered_at).map((i) => i.content_id)
    )
    for (const f of porRevisar) f.sin_nodo_chat_abierto = !conEvidencia.has(f.content_id)
  } catch (err) {
    // Es solo un aviso de diagnóstico: sin él la pestaña sigue funcionando.
    console.error('[getContentTabData] no se pudo calcular el aviso de nodo chat-abierto:', err)
  }
  return resultado
}

// Everything the Contenido tab needs, in one call — fetched only when that
// tab actually opens (clients/[id]/page.tsx no longer pulls this in on
// every page load regardless of which tab is active).
export async function getContentTabData(clientId: string) {
  const supabase = await createClient()
  const [contentPieces, contentMetrics, contentAnalytics, funnelTotals, interactionCounts] = await Promise.all([
    getContentPieces(clientId),
    getContentMetricsByClient(clientId),
    getContentAnalytics(clientId),
    getClientFunnelTotals(clientId),
    getInteractionCountsByPiece(supabase, clientId),
  ])
  return { contentPieces, contentMetrics, contentAnalytics, funnelTotals, interactionCounts }
}

export interface QuickAddResult {
  added: number
  skipped: number
  error?: string
}

export async function quickAddLatestReels(clientId: string, limit = 10): Promise<QuickAddResult> {
  const supabase = await createClient()

  // Get the integration for this client
  const { data: integration, error: intError } = await supabase
    .from('integrations')
    .select('access_token, status, token_expires_at')
    .eq('client_id', clientId)
    .eq('platform', 'instagram')
    .eq('status', 'connected')
    .single()

  if (intError || !integration) {
    return { added: 0, skipped: 0, error: 'No hay integración de Instagram conectada para este cliente.' }
  }

  if (integration.token_expires_at && new Date(integration.token_expires_at) < new Date()) {
    return { added: 0, skipped: 0, error: 'El token de Instagram ha expirado. Reconecta la integración.' }
  }

  // Fetch latest media from IG Graph API
  const mediaRes = await fetch(
    `https://graph.instagram.com/me/media?fields=id,caption,media_type,permalink,thumbnail_url,media_url,timestamp&limit=${limit}&access_token=${integration.access_token}`
  )

  if (!mediaRes.ok) {
    return { added: 0, skipped: 0, error: `Error de la API de Meta: ${mediaRes.status}` }
  }

  const mediaData = await mediaRes.json()
  const mediaItems: Array<{
    id: string
    caption?: string
    media_type: string
    permalink?: string
    thumbnail_url?: string
    media_url?: string
    timestamp: string
  }> = mediaData.data || []

  // Filter only reels (VIDEO type)
  const reels = mediaItems.filter((m) => m.media_type === 'VIDEO')

  let added = 0
  let skipped = 0
  // Solo para subir portadas: el bucket no tiene política de UPDATE. Llegar
  // aquí ya exigió leer la integración con la sesión del usuario (RLS).
  const storage = createAdminClient()

  for (const media of reels) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('content_pieces')
      .select('id')
      .eq('ig_media_id', media.id)
      .eq('client_id', clientId)
      .single()

    if (existing) {
      skipped++
      continue
    }

    // La portada va a Storage antes del insert; si la subida falla queda la
    // URL del CDN, que el cron diario reemplaza después. Nunca un mp4.
    const origen = elegirPortada(media)
    const portada = (await guardarPortada(storage, clientId, media.id, origen)) ?? origen

    const { error: insertError } = await supabase.from('content_pieces').insert({
      client_id: clientId,
      content_type: 'reel',
      ig_media_id: media.id,
      ig_permalink: media.permalink || null,
      ig_thumbnail_url: portada,
      caption: media.caption || null,
      published_at: media.timestamp,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
      metrics_source: 'manual',
      metrics_updated_at: new Date().toISOString(),
    })

    if (!insertError) {
      added++
    }
  }

  revalidatePath(`/clients/${clientId}`)
  return { added, skipped }
}
