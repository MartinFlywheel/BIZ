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
    .select('first_touch_content_id, close_value')
    .eq('client_id', clientId)
    .eq('stage', 'closed_won')
    .not('first_touch_content_id', 'is', null)
    .not('close_value', 'is', null)

  const revenueByContent: Record<string, number> = {}
  const cierresByContent: Record<string, number> = {}
  let total_revenue = 0

  for (const lead of closedLeads || []) {
    const cid = lead.first_touch_content_id!
    const val = lead.close_value || 0
    revenueByContent[cid] = (revenueByContent[cid] || 0) + val
    cierresByContent[cid] = (cierresByContent[cid] || 0) + 1
    total_revenue += val
  }

  // Also check content_metrics for manual revenue
  const { data: metrics } = await supabase
    .from('content_metrics')
    .select('content_id, cash_collected, cierres')
    .eq('client_id', clientId)

  for (const m of metrics || []) {
    if (m.cash_collected && m.cash_collected > 0) {
      revenueByContent[m.content_id] = (revenueByContent[m.content_id] || 0) + m.cash_collected
      cierresByContent[m.content_id] = (cierresByContent[m.content_id] || 0) + (m.cierres || 0)
      if (!closedLeads?.some((l) => l.first_touch_content_id === m.content_id)) {
        total_revenue += m.cash_collected
      }
    }
  }

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

  return {
    engagement: { ...engagement, engagement_rate },
    top_by_revenue,
    top_by_views,
    top_by_chats,
    total_revenue,
    total_pieces: allPieces.length,
  }
}
