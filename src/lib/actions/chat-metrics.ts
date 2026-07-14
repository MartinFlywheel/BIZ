'use server'

import { getLiveMetricsBuckets, type PeriodMetrics } from './live-metrics'

export type DailyLiveMetric = PeriodMetrics & { date: string }

// One row per day of the given month, computed live from interactions
// (ManyChat) and agenda_records (Calendly + CRM closing) — no manual entry.
export async function getDailyLiveMetrics(
  clientId: string,
  year: number,
  month: number,
): Promise<DailyLiveMetric[]> {
  const lastDay = new Date(year, month, 0).getDate()
  const buckets = Array.from({ length: lastDay }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    const date = `${year}-${String(month).padStart(2, '0')}-${day}`
    return { key: date, start: date, end: date }
  })

  const byDate = await getLiveMetricsBuckets(clientId, buckets)
  return buckets.map((b) => ({ date: b.key, ...byDate[b.key] }))
}
