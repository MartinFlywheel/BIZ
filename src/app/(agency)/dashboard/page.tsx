import { Suspense } from 'react'
import { getClients } from '@/lib/actions/clients'
import { checkHealthAlerts, calculateFunnel, getComputedClientMetrics, type FunnelPeriodType } from '@/lib/actions/funnel'
import { getDashboardMetrics, getBenchmarkAlerts, getMonthOverMonthComparison } from '@/lib/actions/metrics'
import type { ContentTypeFilter } from '@/lib/actions/live-metrics'
import { MetricCard } from '@/components/dashboard/metric-card'
import { HealthAlerts } from '@/components/dashboard/health-alerts'
import { FunnelView } from '@/components/dashboard/funnel-view'
import { MonthComparisonCards } from '@/components/dashboard/month-comparison'
import { WeeklyTrend } from '@/components/dashboard/weekly-trend'
import { ClientSelector } from '@/components/dashboard/client-selector'
import { ContentTypeToggle } from '@/components/dashboard/content-type-toggle'
import { PeriodToggle } from '@/components/dashboard/period-toggle'
import { Card } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/utils'

const VALID_PERIODS: FunnelPeriodType[] = ['weekly', '15d', '30d', 'monthly']

// ── Skeleton — shown instantly while ClientDetail streams ─────────────────────

const SEG_WIDTHS = [96, 80, 65, 50, 37, 24]
const SEG_H = 88
const GAP = 2

function FunnelSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 rounded-md bg-white/[0.06]" />
          <div className="h-3 w-52 rounded bg-white/[0.03]" />
        </div>
        <div className="h-7 w-52 rounded-lg bg-white/[0.04]" />
      </div>

      {/* Funnel card */}
      <div
        className="rounded-xl p-5"
        style={{
          background: 'rgba(255,255,255,0.022)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="h-3 w-32 rounded bg-white/[0.04] mb-5" />
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
          {/* Funnel shape */}
          <div className="flex-1 flex flex-col" style={{ gap: GAP }}>
            {SEG_WIDTHS.map((w, i) => (
              <div
                key={i}
                className="mx-auto rounded-sm"
                style={{
                  width: `${w}%`,
                  height: SEG_H,
                  background: `rgba(255,255,255,${0.025 + i * 0.005})`,
                }}
              />
            ))}
          </div>
          {/* Rate panel */}
          <div className="w-full sm:w-44 shrink-0 flex flex-col" style={{ gap: GAP }}>
            {SEG_WIDTHS.map((_, i) => (
              <div key={i} className="flex flex-col justify-center px-4 gap-2" style={{ height: SEG_H }}>
                {i > 0 && (
                  <>
                    <div className="h-2 w-24 rounded bg-white/[0.04]" />
                    <div className="h-5 w-14 rounded bg-white/[0.05]" />
                    <div className="h-2 w-20 rounded bg-white/[0.03]" />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Money cards */}
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{
              background: 'rgba(255,255,255,0.022)',
              border: '1px solid rgba(255,255,255,0.07)',
              height: 96,
            }}
          >
            <div className="h-3 w-24 rounded bg-white/[0.04] mb-3" />
            <div className="h-8 w-28 rounded bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Per-client section — slow queries, streamed in ────────────────────────────

async function ClientDetail({
  clientId,
  clients,
  contentType,
  period,
}: {
  clientId: string
  clients: Awaited<ReturnType<typeof getClients>>
  contentType?: ContentTypeFilter
  period: FunnelPeriodType
}) {
  const selectedClient = clients.find((c) => c.id === clientId)
  if (!selectedClient) return null

  const [funnel, liveMetrics] = await Promise.all([
    calculateFunnel(clientId, period, undefined, contentType),
    getDashboardMetrics(clientId),
  ])

  const alerts = liveMetrics ? await getBenchmarkAlerts(clientId, liveMetrics) : []
  const alertMap = Object.fromEntries(alerts.map((a) => [a.metric_key, a]))

  return (
    // fade-rise is defined in globals.css
    <div className="space-y-8" style={{ animation: 'fade-rise 0.38s cubic-bezier(0.22,1,0.36,1) both' }}>
      {funnel ? (
        <FunnelView funnel={funnel} clientName={selectedClient.name} contentType={contentType} />
      ) : (
        <Card>
          <div className="flex h-32 items-center justify-center text-center text-sm text-zinc-500">
            {selectedClient.name} aún no tiene {contentType ? 'actividad' : 'métricas'} para mostrar en este período.
            {!contentType && (
              <>
                <br />
                Cárgalas desde la ficha del cliente → pestaña Métricas.
              </>
            )}
          </div>
        </Card>
      )}

      {liveMetrics && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-white/90">Métricas en Vivo (CRM)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 2xl:gap-6">
            <MetricCard title="Views"        value={formatNumber(liveMetrics.total_views)} />
            <MetricCard title="Chats Nuevos" value={formatNumber(liveMetrics.chats_abiertos)} />
            <MetricCard title="Conv. Reales" value={formatNumber(liveMetrics.conversaciones_reales)} />
            <MetricCard title="Agendas"      value={formatNumber(liveMetrics.agendas)} />
            <MetricCard title="Cierres"      value={formatNumber(liveMetrics.cierres)} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 2xl:gap-6">
            <MetricCard
              title="Tasa de Respuesta"
              value={formatPercent(liveMetrics.tasa_respuesta)}
              subtitle="Conv. Reales / Chats Nuevos"
              alert={alertMap['tasa_respuesta']}
            />
            <MetricCard
              title="Tasa de Show-up"
              value={formatPercent(liveMetrics.tasa_show_up)}
              subtitle="Show-ups / Llamadas"
              alert={alertMap['tasa_show_up']}
            />
            <MetricCard
              title="Tasa de Cierre"
              value={formatPercent(liveMetrics.tasa_cierre)}
              subtitle="Cierres / Show-ups"
              alert={alertMap['tasa_cierre']}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Health overview — one funnel calculation per active client. Streamed in
// behind its own Suspense boundary so it can't block the page shell (title,
// period/client toggles) from rendering while it works. ─────────────────────

function HealthAlertsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 rounded bg-white/[0.05]" />
        <div className="h-3 w-40 rounded bg-white/[0.03]" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4" style={{ height: 132 }} />
        ))}
      </div>
    </div>
  )
}

async function HealthAlertsSection({ selectedId }: { selectedId?: string }) {
  const alerts = await checkHealthAlerts('weekly')
  return <HealthAlerts alerts={alerts} selectedId={selectedId} />
}

// ── Comparison section — independent of the period/type toggle, so switching
// those doesn't wait on this section's own (heavier) queries. Keyed only by
// clientId: this data doesn't change when the funnel's period does. ─────────

function ComparisonSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 w-40 rounded bg-white/[0.05]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.022)', border: '1px solid rgba(255,255,255,0.07)', height: 104 }} />
        ))}
      </div>
    </div>
  )
}

async function ComparisonSection({ clientId }: { clientId: string }) {
  const [monthComparison, weeklyTrend] = await Promise.all([
    getMonthOverMonthComparison(clientId),
    getComputedClientMetrics(clientId, 'weekly', 8),
  ])

  return (
    <div className="space-y-8">
      <MonthComparisonCards comparison={monthComparison} />
      <WeeklyTrend weeks={weeklyTrend} />
    </div>
  )
}

// ── Page shell — renders immediately ─────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; type?: string; period?: string }>
}) {
  const { client: clientId, type, period: periodParam } = await searchParams
  const contentType: ContentTypeFilter | undefined = type === 'reel' || type === 'story' ? type : undefined
  const period: FunnelPeriodType = VALID_PERIODS.includes(periodParam as FunnelPeriodType)
    ? (periodParam as FunnelPeriodType)
    : 'weekly'

  // Only clients is fast — health alerts run one funnel calculation per
  // active client and stream in behind their own Suspense below instead.
  const clients = await getClients()

  return (
    <div className="stagger-children space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">Salud del funnel y métricas de conversión</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodToggle selected={periodParam} />
          <ContentTypeToggle selected={type} />
          <ClientSelector clients={clients} selectedId={clientId} />
        </div>
      </div>

      {/* Agency-wide health overview — always visible, streamed independently
          of the page shell so a slow client (or many active clients) can't
          delay the title/toggles from showing up. */}
      <Suspense fallback={<HealthAlertsSkeleton />}>
        <HealthAlertsSection selectedId={clientId} />
      </Suspense>

      {/* Per-client: streams in behind a skeleton, key resets on client switch.
          Two independent Suspense boundaries — switching the period/type
          toggle only re-triggers the funnel one (fast: a couple of queries)
          instead of also waiting on the comparison section's heavier,
          period-irrelevant queries (a 56-day live-metrics scan). */}
      {clientId && (
        <>
          <Suspense key={`${clientId}-${type || 'all'}-${period}`} fallback={<FunnelSkeleton />}>
            <ClientDetail clientId={clientId} clients={clients} contentType={contentType} period={period} />
          </Suspense>
          <Suspense key={clientId} fallback={<ComparisonSkeleton />}>
            <ComparisonSection clientId={clientId} />
          </Suspense>
        </>
      )}
    </div>
  )
}
