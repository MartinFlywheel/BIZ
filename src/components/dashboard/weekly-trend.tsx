import { Card, CardTitle } from '@/components/ui/card'
import { formatDate, formatCurrency, formatNumber } from '@/lib/utils'
import { DeltaBadge } from './month-comparison'
import type { ComputedMetricsRow } from '@/lib/actions/funnel'

interface Props {
  // Most-recent-first, as returned by getComputedClientMetrics.
  weeks: ComputedMetricsRow[]
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

export function WeeklyTrend({ weeks }: Props) {
  if (weeks.length === 0) return null

  return (
    <div className="space-y-3">
      <CardTitle className="text-sm font-medium text-white/90">Tendencia Semanal</CardTitle>
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">Semana</th>
                <th className="px-4 py-3 font-medium">Chats</th>
                <th className="px-4 py-3 font-medium">Ventas (cierres)</th>
                <th className="px-4 py-3 font-medium">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, i) => {
                const previous = weeks[i + 1]
                return (
                  <tr key={week.period_start} className="border-b border-zinc-900 last:border-0">
                    <td className="px-4 py-3 text-zinc-400">
                      {formatDate(week.period_start)} – {formatDate(week.period_end)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-100">{formatNumber(week.chats_abiertos)}</span>
                        {previous && <DeltaBadge deltaPct={pctChange(week.chats_abiertos, previous.chats_abiertos)} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-100">{formatNumber(week.cierres)}</span>
                        {previous && <DeltaBadge deltaPct={pctChange(week.cierres, previous.cierres)} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-zinc-100">{formatCurrency(week.facturacion)}</span>
                        {previous && <DeltaBadge deltaPct={pctChange(week.facturacion, previous.facturacion)} />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
