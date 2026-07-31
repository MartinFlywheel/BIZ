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
        'glass-interactive',
        isFailing &&
        'border-[#8B0D1A]/30 bg-[#8B0D1A]/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_30px_rgba(139,13,26,0.2)] hover:border-[#8B0D1A]/50 hover:bg-[#8B0D1A]/[0.12] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_8px_40px_rgba(139,13,26,0.3)]'
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
