import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { BenchmarkAlert } from '@/lib/types'

interface MetricCardProps {
  title: string
  value: string
  subtitle?: string
  alert?: BenchmarkAlert
}

export function MetricCard({ title, value, subtitle, alert }: MetricCardProps) {
  const isFailing = alert?.is_failing

  return (
    <Card
      className={cn(
        'transition-all duration-200 hover:border-white/[0.1] hover:bg-white/[0.04]',
        isFailing &&
        'border-[#ff453a]/25 bg-[#ff453a]/[0.06] hover:border-[#ff453a]/40 hover:bg-[#ff453a]/[0.1]'
      )}
    >
      <CardTitle className={cn(isFailing && 'text-red-300/80')}>{title}</CardTitle>
      <CardValue className={cn('mt-2', isFailing && 'text-red-300')}>{value}</CardValue>
      {subtitle && (
        <p
          className={cn(
            'mt-1 text-xs',
            isFailing ? 'text-red-400/70' : 'text-zinc-500'
          )}
        >
          {subtitle}
        </p>
      )}
      {isFailing && alert?.diagnosis_message && (
        <p className="mt-2 text-xs leading-relaxed text-red-400/90">
          {alert.diagnosis_message}
        </p>
      )}
    </Card>
  )
}
