'use server'

// Atribución de personas a anuncios de Meta.
//
// Cuando alguien escribe por un anuncio "click to WhatsApp", Meta entrega al
// agente un referral con el id del anuncio (source_id). El agente lo manda al
// CRM y queda en leads.referral (migración 065). Aquí se cruza eso con los
// anuncios de la cuenta publicitaria (nombres y campaña cacheados en
// meta_ads, migración 066; gasto en vivo desde Meta) para responder "de qué
// anuncio vienen las personas que califican, agendan y cierran".
//
// Degrada si faltan migraciones: sin la 065 responde 'sin_migracion' y la
// pestaña muestra un aviso; sin la 066 sigue funcionando con los nombres que
// traiga Meta en vivo, solo que los anuncios ya borrados quedan sin nombre.

import { createClient } from '@/lib/supabase/server'
import { fetchAllRows, fetchAllByIds } from '@/lib/supabase/paginate'

const COLUMNA_INEXISTENTE = '42703'
const TABLA_INEXISTENTE = '42P01'
const DATE_PRESET = 'last_30d'
const ETAPAS_AGENDADO = new Set(['agendado', 'agenda_set'])
const ETAPAS_CIERRE = new Set(['cierre', 'cliente', 'closed_won'])

export interface AtribucionAnuncio {
  adId: string
  adName: string
  status: string | null
  spend: number
  conversaciones: number
  calificados: number
  agendados: number
  cierres: number
}

export interface AtribucionCampana {
  campaignId: string
  campaignName: string
  spend: number
  conversaciones: number
  calificados: number
  agendados: number
  cierres: number
  ads: AtribucionAnuncio[]
}

export type AtribucionResult =
  | { status: 'sin_migracion' }
  | { status: 'sin_datos' }
  | { status: 'success'; campanas: AtribucionCampana[]; totales: Omit<AtribucionAnuncio, 'adId' | 'adName' | 'status'> }

interface MetaAd {
  id: string
  name: string
  status?: string
  campaign_id?: string
  campaign?: { id?: string; name?: string }
  adset?: { name?: string }
  insights?: { data?: { spend?: string }[] }
}

/**
 * Trae todos los anuncios de la cuenta con su campaña y gasto de 30 días.
 * Meta pagina de a 200; se siguen los enlaces `next` hasta 10 páginas.
 */
async function anunciosDesdeMeta(adAccountId: string, token: string): Promise<MetaAd[]> {
  const campos = `id,name,status,campaign_id,campaign{id,name},adset{name},insights.date_preset(${DATE_PRESET}){spend}`
  let url: string | null = `https://graph.facebook.com/v21.0/${adAccountId}/ads?fields=${campos}&limit=200&access_token=${token}`
  const todos: MetaAd[] = []
  for (let pagina = 0; url && pagina < 10; pagina++) {
    const res: Response = await fetch(url)
    if (!res.ok) break
    const json: { data?: MetaAd[]; paging?: { next?: string } } = await res.json()
    todos.push(...(json.data ?? []))
    url = json.paging?.next ?? null
  }
  return todos
}

interface FilaMetaAd {
  ad_id: string
  ad_name: string | null
  status: string | null
  campaign_id: string | null
  campaign_name: string | null
}

/** Id del anuncio dentro del referral, tolerando las variantes que manda Meta o el agente. */
function adIdDelReferral(referral: unknown): string | null {
  if (!referral || typeof referral !== 'object') return null
  const r = referral as Record<string, unknown>
  for (const k of ['source_id', 'ad_id', 'adId']) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export async function getAtribucionAnuncios(clientId: string): Promise<AtribucionResult> {
  const supabase = await createClient()

  // 1. Personas con anuncio de origen.
  let leads: { id: string; stage: string; interaction_id: string | null; referral: unknown }[]
  try {
    leads = await fetchAllRows<{ id: string; stage: string; interaction_id: string | null; referral: unknown }>((from, to) =>
      supabase
        .from('leads')
        .select('id, stage, interaction_id, referral')
        .eq('client_id', clientId)
        .not('referral', 'is', null)
        .range(from, to)
    )
  } catch (e) {
    const code = (e as { code?: string } | null)?.code
    const mensaje = e instanceof Error ? e.message : String(e)
    if (code === COLUMNA_INEXISTENTE || mensaje.includes('referral')) return { status: 'sin_migracion' }
    throw e
  }

  const conAnuncio = leads
    .map((l) => ({ ...l, adId: adIdDelReferral(l.referral) }))
    .filter((l): l is typeof l & { adId: string } => !!l.adId)

  if (conAnuncio.length === 0) return { status: 'sin_datos' }

  // 2. Calificados: por la clasificación de su interacción, igual que el CRM.
  const interactionIds = conAnuncio.map((l) => l.interaction_id).filter((id): id is string => !!id)
  const interacciones = await fetchAllByIds<{ id: string; classification: string | null }>(
    interactionIds,
    (chunk) => supabase.from('interactions').select('id, classification').in('id', chunk)
  )
  const calificadosPorInteraccion = new Set(
    interacciones.filter((i) => i.classification === 'lead_calificado').map((i) => i.id)
  )

  // 3. Agendados: por etapa o porque tienen fila en agendas (la lectura de
  // Calendly crea la fila aunque la etapa no se haya movido).
  const agendas = await fetchAllByIds<{ lead_id: string | null }>(
    conAnuncio.map((l) => l.id),
    (chunk) => supabase.from('agenda_records').select('lead_id').in('lead_id', chunk)
  )
  const conAgenda = new Set(agendas.map((a) => a.lead_id).filter((id): id is string => !!id))

  // 4. Anuncios: nombres y campaña desde Meta en vivo, cacheados en meta_ads.
  const { data: cliente } = await supabase.from('clients').select('ad_account_id').eq('id', clientId).single()
  const token = process.env.META_SYSTEM_USER_TOKEN
  const enVivo = cliente?.ad_account_id && token ? await anunciosDesdeMeta(cliente.ad_account_id, token) : []

  const gastoPorAd = new Map<string, number>()
  const infoPorAd = new Map<string, FilaMetaAd>()
  for (const a of enVivo) {
    gastoPorAd.set(a.id, Number(a.insights?.data?.[0]?.spend) || 0)
    infoPorAd.set(a.id, {
      ad_id: a.id,
      ad_name: a.name,
      status: a.status ?? null,
      campaign_id: a.campaign_id ?? a.campaign?.id ?? null,
      campaign_name: a.campaign?.name ?? null,
    })
  }

  if (enVivo.length > 0) {
    const { error } = await supabase.from('meta_ads').upsert(
      enVivo.map((a) => ({
        client_id: clientId,
        ad_id: a.id,
        ad_name: a.name,
        status: a.status ?? null,
        campaign_id: a.campaign_id ?? a.campaign?.id ?? null,
        campaign_name: a.campaign?.name ?? null,
        adset_name: a.adset?.name ?? null,
        actualizado_at: new Date().toISOString(),
      })),
      { onConflict: 'client_id,ad_id' }
    )
    if (error && error.code !== TABLA_INEXISTENTE) console.error('[ad-attribution] no se pudo cachear meta_ads:', error.message)
  }

  // Anuncios que Meta ya no devuelve (borrados, o fuera de la ventana): se
  // toman del caché para no mostrarlos como "desconocidos".
  const faltantes = [...new Set(conAnuncio.map((l) => l.adId))].filter((id) => !infoPorAd.has(id))
  if (faltantes.length > 0) {
    const { data: cacheados, error } = await supabase
      .from('meta_ads')
      .select('ad_id, ad_name, status, campaign_id, campaign_name')
      .eq('client_id', clientId)
      .in('ad_id', faltantes)
    if (!error) for (const c of cacheados ?? []) infoPorAd.set(c.ad_id, c)
  }

  // 5. Contar por anuncio y agrupar por campaña.
  const porAd = new Map<string, AtribucionAnuncio>()
  for (const l of conAnuncio) {
    const info = infoPorAd.get(l.adId)
    const fila = porAd.get(l.adId) ?? {
      adId: l.adId,
      adName: info?.ad_name ?? `Anuncio ${l.adId}`,
      status: info?.status ?? null,
      spend: gastoPorAd.get(l.adId) ?? 0,
      conversaciones: 0, calificados: 0, agendados: 0, cierres: 0,
    }
    fila.conversaciones++
    if (l.interaction_id && calificadosPorInteraccion.has(l.interaction_id)) fila.calificados++
    if (ETAPAS_AGENDADO.has(l.stage) || ETAPAS_CIERRE.has(l.stage) || conAgenda.has(l.id)) fila.agendados++
    if (ETAPAS_CIERRE.has(l.stage)) fila.cierres++
    porAd.set(l.adId, fila)
  }

  const porCampana = new Map<string, AtribucionCampana>()
  for (const ad of porAd.values()) {
    const info = infoPorAd.get(ad.adId)
    const campaignId = info?.campaign_id ?? 'sin_campana'
    const c = porCampana.get(campaignId) ?? {
      campaignId,
      campaignName: info?.campaign_name ?? 'Campaña desconocida',
      spend: 0, conversaciones: 0, calificados: 0, agendados: 0, cierres: 0,
      ads: [],
    }
    c.spend += ad.spend
    c.conversaciones += ad.conversaciones
    c.calificados += ad.calificados
    c.agendados += ad.agendados
    c.cierres += ad.cierres
    c.ads.push(ad)
    porCampana.set(campaignId, c)
  }

  const campanas = [...porCampana.values()]
    .map((c) => ({ ...c, ads: c.ads.sort((a, b) => b.agendados - a.agendados || b.conversaciones - a.conversaciones) }))
    .sort((a, b) => b.agendados - a.agendados || b.conversaciones - a.conversaciones)

  const totales = campanas.reduce(
    (t, c) => ({
      spend: t.spend + c.spend,
      conversaciones: t.conversaciones + c.conversaciones,
      calificados: t.calificados + c.calificados,
      agendados: t.agendados + c.agendados,
      cierres: t.cierres + c.cierres,
    }),
    { spend: 0, conversaciones: 0, calificados: 0, agendados: 0, cierres: 0 }
  )

  return { status: 'success', campanas, totales }
}
