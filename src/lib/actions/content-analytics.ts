'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'

export interface ContentAnalytics {
  engagement: {
    total_likes: number
    total_saves: number
    total_comments: number
    total_shares: number
    total_views: number
    engagement_rate: number
  }
  top_by_revenue: Array<{
    content_id: string
    caption: string | null
    keyword_trigger: string | null
    ig_thumbnail_url: string | null
    revenue: number
    cierres: number
  }>
  top_by_views: Array<{
    content_id: string
    caption: string | null
    keyword_trigger: string | null
    ig_thumbnail_url: string | null
    views: number
  }>
  top_by_chats: Array<{
    content_id: string
    caption: string | null
    keyword_trigger: string | null
    chats: number
  }>
  total_revenue: number
  total_pieces: number
  // Full per-piece revenue/cierres/agendas/shows map (leads.close_value +
  // agenda_records "Cerrado" rows for revenue/cierres, all agenda_records
  // rows for agendas/shows regardless of estado, + content_metrics manual
  // entry, merged) — top_by_revenue above is only the top 5, but every
  // piece's card needs its own number.
  revenue_by_content_id: Record<string, { revenue: number; cierres: number; agendas: number; shows: number }>
}

export async function getContentAnalytics(clientId: string): Promise<ContentAnalytics> {
  const supabase = await createClient()

  const allPieces = await fetchAllRows((from, to) =>
    supabase
      .from('content_pieces')
      .select('id, caption, keyword_trigger, ig_thumbnail_url, views, likes, comments, shares, saves')
      .eq('client_id', clientId)
      .range(from, to)
  )

  const engagement = allPieces.reduce(
    (acc, p) => ({
      total_likes: acc.total_likes + (p.likes || 0),
      total_saves: acc.total_saves + (p.saves || 0),
      total_comments: acc.total_comments + (p.comments || 0),
      total_shares: acc.total_shares + (p.shares || 0),
      total_views: acc.total_views + (p.views || 0),
    }),
    { total_likes: 0, total_saves: 0, total_comments: 0, total_shares: 0, total_views: 0 }
  )

  const totalEngagement = engagement.total_likes + engagement.total_saves + engagement.total_comments
  const engagement_rate = engagement.total_views > 0
    ? Math.round((totalEngagement / engagement.total_views) * 10000) / 100
    : 0

  // Revenue attribution: leads with close_value linked to content via first_touch_content_id
  const { data: closedLeads } = await supabase
    .from('leads')
    .select('id, first_touch_content_id, close_value')
    .eq('client_id', clientId)
    .eq('stage', 'closed_won')
    .not('first_touch_content_id', 'is', null)
    .not('close_value', 'is', null)

  const revenueByContent: Record<string, number> = {}
  const cierresByContent: Record<string, number> = {}
  const agendasByContent: Record<string, number> = {}
  const showsByContent: Record<string, number> = {}
  const leadIdsAlreadyCounted = new Set<string>()

  for (const lead of closedLeads || []) {
    const cid = lead.first_touch_content_id!
    const val = lead.close_value || 0
    revenueByContent[cid] = (revenueByContent[cid] || 0) + val
    cierresByContent[cid] = (cierresByContent[cid] || 0) + 1
    leadIdsAlreadyCounted.add(lead.id)
  }

  // Also pull closes recorded in the Agendas sheet (agenda_records) — the
  // place the team actually marks a lead "Cerrado" day to day now, separate
  // from the older leads.close_value path above. Most Agendas rows are typed
  // in directly (Agregar lead) and never get a lead_id, so attribution tries
  // lead_id -> leads.first_touch_content_id first, then falls back to
  // matching the row's CTA text against the piece's keyword_trigger — the
  // same ID (e.g. "H_13_07") shown on each content card and used by the
  // ManyChat webhook, sometimes stored here with a "manychat:" prefix.
  function normalizeCta(raw: string | null): string | null {
    if (!raw) return null
    const trimmed = raw.trim().replace(/^manychat:/i, '')
    return trimmed || null
  }
  const keywordTriggerToContentId = Object.fromEntries(
    allPieces.filter((p) => p.keyword_trigger).map((p) => [p.keyword_trigger as string, p.id])
  )

  const { data: allAgendas } = await supabase
    .from('agenda_records')
    .select('lead_id, de_donde_vino, estado, monto_facturacion, monto_upfront')
    .eq('client_id', clientId)

  if (allAgendas && allAgendas.length > 0) {
    const leadIds = Array.from(
      new Set(allAgendas.map((a) => a.lead_id).filter((id): id is string => !!id))
    )
    const { data: leadsForAgendas } = leadIds.length > 0
      ? await supabase.from('leads').select('id, first_touch_content_id').in('id', leadIds)
      : { data: [] }
    const contentIdByLeadId = Object.fromEntries(
      (leadsForAgendas || [])
        .filter((l) => l.first_touch_content_id)
        .map((l) => [l.id, l.first_touch_content_id as string])
    )

    for (const a of allAgendas) {
      const leadId = a.lead_id as string | null
      const cid = (leadId && contentIdByLeadId[leadId])
        || keywordTriggerToContentId[normalizeCta(a.de_donde_vino as string | null) ?? '']
      if (!cid) continue

      agendasByContent[cid] = (agendasByContent[cid] || 0) + 1

      if (a.estado && ['Show', 'No Cerrado', 'Cerrado'].includes(a.estado)) {
        showsByContent[cid] = (showsByContent[cid] || 0) + 1
      }

      if (a.estado === 'Cerrado') {
        if (leadId && leadIdsAlreadyCounted.has(leadId)) continue
        const val = Number(a.monto_facturacion) || Number(a.monto_upfront) || 0
        if (val > 0) {
          revenueByContent[cid] = (revenueByContent[cid] || 0) + val
          cierresByContent[cid] = (cierresByContent[cid] || 0) + 1
          if (leadId) leadIdsAlreadyCounted.add(leadId)
        }
      }
    }
  }

  // Manual overrides from content_metrics replace the automatically-computed
  // totals for that content piece (per the form's "sobrescribir" promise),
  // rather than adding on top of them.
  const { data: metrics } = await supabase
    .from('content_metrics')
    .select('content_id, cash_collected, cierres, agendas, shows')
    .eq('client_id', clientId)

  for (const m of metrics || []) {
    if (m.agendas && m.agendas > 0) {
      agendasByContent[m.content_id] = m.agendas
    }
    if (m.shows && m.shows > 0) {
      showsByContent[m.content_id] = m.shows
    }
    if (m.cash_collected && m.cash_collected > 0) {
      revenueByContent[m.content_id] = m.cash_collected
      cierresByContent[m.content_id] = m.cierres || 0
    }
  }

  const total_revenue = Object.values(revenueByContent).reduce((sum, v) => sum + v, 0)

  const pieceMap = new Map(allPieces.map((p) => [p.id, p]))

  const top_by_revenue = Object.entries(revenueByContent)
    .map(([content_id, revenue]) => {
      const p = pieceMap.get(content_id)
      return {
        content_id,
        caption: p?.caption || null,
        keyword_trigger: p?.keyword_trigger || null,
        ig_thumbnail_url: p?.ig_thumbnail_url || null,
        revenue,
        cierres: cierresByContent[content_id] || 0,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const top_by_views = allPieces
    .filter((p) => p.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)
    .map((p) => ({
      content_id: p.id,
      caption: p.caption,
      keyword_trigger: p.keyword_trigger,
      ig_thumbnail_url: p.ig_thumbnail_url,
      views: p.views,
    }))

  // Top by chats (from content_metrics)
  const { data: chatMetrics } = await supabase
    .from('content_metrics')
    .select('content_id, chats_nuevos')
    .eq('client_id', clientId)
    .gt('chats_nuevos', 0)
    .order('chats_nuevos', { ascending: false })
    .limit(5)

  const top_by_chats = (chatMetrics || []).map((m) => {
    const p = pieceMap.get(m.content_id)
    return {
      content_id: m.content_id,
      caption: p?.caption || null,
      keyword_trigger: p?.keyword_trigger || null,
      chats: m.chats_nuevos,
    }
  })

  const revenue_by_content_id = Object.fromEntries(
    allPieces.map((p) => {
      const content_id = p.id
      const revenue = revenueByContent[content_id] || 0
      const cierres = cierresByContent[content_id] || 0
      const agendas = agendasByContent[content_id] || 0
      const shows = showsByContent[content_id] || 0
      return [content_id, { revenue, cierres, agendas, shows }]
    })
  )

  return {
    engagement: { ...engagement, engagement_rate },
    top_by_revenue,
    top_by_views,
    top_by_chats,
    total_revenue,
    total_pieces: allPieces.length,
    revenue_by_content_id,
  }
}
