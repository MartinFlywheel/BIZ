import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { cn, formatDate, formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { MonthComparison, MonthComparisonMetric, RateComparisonMetric } from '@/lib/actions/metrics'

interface Props {
  comparison: MonthComparison
}

export function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
        Nuevo
      </span>
    )
  }

  if (deltaPct === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
        <Minus className="h-3 w-3" />
        Se mantuvo
      </span>
    )
  }

  const isUp = deltaPct > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
      )}
    >
      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(deltaPct).toFixed(0)}%
    </span>
  )
}

// Rates compare as a point difference (already a %), not a relative % change
// of a percentage — "+5 pts" (10% → 15%) is what actually happened; reading
// that as "+50%" would be confusing.
function DeltaPointsBadge({ deltaPoints }: { deltaPoints: number }) {
  const rounded = Math.round(deltaPoints * 10) / 10

  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
        <Minus className="h-3 w-3" />
        Se mantuvo
      </span>
    )
  }

  const isUp = rounded > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
      )}
    >
      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isUp ? '+' : ''}{rounded.toFixed(1)} pts
    </span>
  )
}

function ComparisonTile({
  title,
  metric,
  format,
}: {
  title: string
  metric: MonthComparisonMetric
  format: (value: number) => string
}) {
  return (
    <Card className="glass-interactive">
      <div className="flex items-start justify-between">
        <CardTitle>{title}</CardTitle>
        <DeltaBadge deltaPct={metric.deltaPct} />
      </div>
      <CardValue className="mt-2">{format(metric.current)}</CardValue>
      <p className="mt-1 text-xs text-zinc-500">
        vs. {format(metric.previous)} el período anterior
      </p>
    </Card>
  )
}

function RateTile({ title, metric }: { title: string; metric: RateComparisonMetric }) {
  return (
    <Card className="glass-interactive">
      <div className="flex items-start justify-between">
        <CardTitle>{title}</CardTitle>
        <DeltaPointsBadge deltaPoints={metric.deltaPoints} />
      </div>
      <CardValue className="mt-2">{formatPercent(metric.current)}</CardValue>
      <p className="mt-1 text-xs text-zinc-500">
        vs. {formatPercent(metric.previous)} el período anterior
      </p>
    </Card>
  )
}

export function MonthComparisonCards({ comparison }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-white/90">Comparativa Mensual</h2>
        <p className="text-xs text-zinc-500">
          {formatDate(comparison.currentRange.start)} – {formatDate(comparison.currentRange.end)}
          {' '}vs.{' '}
          {formatDate(comparison.previousRange.start)} – {formatDate(comparison.previousRange.end)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <ComparisonTile title="Views" metric={comparison.views} format={formatNumber} />
        <ComparisonTile title="Chats" metric={comparison.chats} format={formatNumber} />
        <ComparisonTile title="Conversaciones" metric={comparison.conversaciones} format={formatNumber} />
        <ComparisonTile title="Agendas" metric={comparison.agendas} format={formatNumber} />
        <ComparisonTile title="Ventas (cierres)" metric={comparison.cierres} format={formatNumber} />
        <ComparisonTile title="Facturación" metric={comparison.facturacion} format={formatCurrency} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RateTile title="Tasa de Respuesta" metric={comparison.tasaRespuesta} />
        <RateTile title="Tasa de Agendamiento" metric={comparison.tasaAgendamiento} />
        <RateTile title="Tasa de Show-up" metric={comparison.tasaShowUp} />
        <RateTile title="Tasa de Cierre" metric={comparison.tasaCierre} />
      </div>
    </div>
  )
}
