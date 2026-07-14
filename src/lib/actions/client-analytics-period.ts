'use server'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveMetricsForRange } from './live-metrics'

export type ClientAnalyticsPeriod = {
  period: {
    days: number
    start: string
    end: string
  }
  totals: {
    views: number
    likes: number
    comments: number
    saves: number
    reach: number
    chats_abiertos: number
    conversaciones: number
    views_historias: number
    facturacion: number
    cash_collected: number
    cierres: number
  }
  vs_prev: {
    views: number | null
    likes: number | null
    comments: number | null
    saves: number | null
    reach: number | null
    chats_abiertos: number | null
    facturacion: number | null
    cash_collected: number | null
  }
  time_series: Array<{
    date: string
    label: string
    views: number
    likes: number
    comments: number
    saves: number
    reach: number
  }>
}

function sum<T extends Record<string, unknown>>(arr: T[], key: keyof T): number {
  return arr.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function fmtLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export async function getClientAnalyticsByPeriod(
  clientId: string,
  days: 7 | 15 | 30 | 90 = 90
): Promise<ClientAnalyticsPeriod> {
  const supabase = await createClient()

  const now = new Date()
  const periodStart = new Date(now.getTime() - days * 86_400_000)
  const prevStart = new Date(periodStart.getTime() - days * 86_400_000)
  const prevEnd = new Date(periodStart.getTime() - 86_400_000)

  const periodStartIso = periodStart.toISOString()
  const prevStartIso = prevStart.toISOString()
  const todayDate = now.toISOString().split('T')[0]
  const periodStartDate = periodStartIso.split('T')[0]
  const prevStartDate = prevStartIso.split('T')[0]
  const prevEndDate = prevEnd.toISOString().split('T')[0]

  const [curPiecesRes, prevPiecesRes, curLive, prevLive] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('id, views, likes, comments, saves, reach, published_at')
      .eq('client_id', clientId)
      .gte('published_at', periodStartIso)
      .order('published_at', { ascending: true }),

    supabase
      .from('content_pieces')
      .select('views, likes, comments, saves, reach')
      .eq('client_id', clientId)
      .gte('published_at', prevStartIso)
      .lt('published_at', periodStartIso),

    getEffectiveMetricsForRange(clientId, periodStartDate, todayDate),
    getEffectiveMetricsForRange(clientId, prevStartDate, prevEndDate),
  ])

  const cur = curPiecesRes.data || []
  const prev = prevPiecesRes.data || []
  const totals = {
    views: sum(cur, 'views'),
    likes: sum(cur, 'likes'),
    comments: sum(cur, 'comments'),
    saves: sum(cur, 'saves'),
    reach: sum(cur, 'reach'),
    chats_abiertos: curLive.chats_abiertos,
    conversaciones: curLive.conversaciones,
    views_historias: curLive.views_historias,
    facturacion: curLive.facturacion,
    cash_collected: curLive.cash_collected,
    cierres: curLive.cierres,
  }

  const prevTotals = {
    views: sum(prev, 'views'),
    likes: sum(prev, 'likes'),
    comments: sum(prev, 'comments'),
    saves: sum(prev, 'saves'),
    reach: sum(prev, 'reach'),
    chats_abiertos: prevLive.chats_abiertos,
    facturacion: prevLive.facturacion,
    cash_collected: prevLive.cash_collected,
  }

  // Build daily time series
  const dayMap = new Map<string, { views: number; likes: number; comments: number; saves: number; reach: number }>()
  for (let d = 0; d < days; d++) {
    const date = new Date(periodStart.getTime() + d * 86_400_000).toISOString().split('T')[0]
    dayMap.set(date, { views: 0, likes: 0, comments: 0, saves: 0, reach: 0 })
  }

  for (const piece of cur) {
    const date = piece.published_at?.split('T')[0]
    if (!date) continue
    const entry = dayMap.get(date)
    if (entry) {
      entry.views += piece.views || 0
      entry.likes += piece.likes || 0
      entry.comments += piece.comments || 0
      entry.saves += piece.saves || 0
      entry.reach += piece.reach || 0
    }
  }

  const time_series = Array.from(dayMap.entries()).map(([date, data]) => ({
    date,
    label: fmtLabel(date),
    ...data,
  }))

  return {
    period: { days, start: periodStartIso, end: now.toISOString() },
    totals,
    vs_prev: {
      views: pctChange(totals.views, prevTotals.views),
      likes: pctChange(totals.likes, prevTotals.likes),
      comments: pctChange(totals.comments, prevTotals.comments),
      saves: pctChange(totals.saves, prevTotals.saves),
      reach: pctChange(totals.reach, prevTotals.reach),
      chats_abiertos: pctChange(totals.chats_abiertos, prevTotals.chats_abiertos),
      facturacion: pctChange(totals.facturacion, prevTotals.facturacion),
      cash_collected: pctChange(totals.cash_collected, prevTotals.cash_collected),
    },
    time_series,
  }
}
