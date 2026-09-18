import { Suspense } from 'react'
import { getClientOptions } from '@/lib/actions/clients'
import { checkHealthAlerts, calculateFunnel, getComputedClientMetrics, type RangoPersonalizado } from '@/lib/actions/funnel'
import { getComparacionDePeriodos } from '@/lib/actions/metrics'
import { periodBounds, periodoAnterior, type FunnelPeriodType, type Rango } from '@/lib/periodos'
import { hoyChile } from '@/lib/fecha-chile'
import type { ContentTypeFilter } from '@/lib/actions/live-metrics'
import { HealthAlerts } from '@/components/dashboard/health-alerts'
import { FunnelView } from '@/components/dashboard/funnel-view'
import { MonthComparisonCards } from '@/components/dashboard/month-comparison'
import { WeeklyTrend } from '@/components/dashboard/weekly-trend'
import { ClientSelector } from '@/components/dashboard/client-selector'
import { ContentTypeToggle } from '@/components/dashboard/content-type-toggle'
import { PeriodToggle } from '@/components/dashboard/period-toggle'
import { Card } from '@/components/ui/card'

const VALID_PERIODS: FunnelPeriodType[] = ['weekly', '15d', '30d', 'monthly']

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** ?period=custom&desde=&hasta= válido, o null (y se cae a la semana). */
function leerRango(period?: string, desde?: string, hasta?: string): RangoPersonalizado | null {
  if (period !== 'custom' || !desde || !hasta) return null
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return null
  if (Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) return null
  return { start: desde, end: hasta }
}

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
  rango,
}: {
  clientId: string
  clients: Awaited<ReturnType<typeof getClientOptions>>
  contentType?: ContentTypeFilter
  period: FunnelPeriodType
  rango: RangoPersonalizado | null
}) {
  const selectedClient = clients.find((c) => c.id === clientId)
  if (!selectedClient) return null

  // Solo el embudo. Aquí había además "Métricas en Vivo (CRM)": cinco
  // tarjetas y tres tasas calculadas sobre TODA la historia del cliente,
  // ignorando el período y el filtro, al lado de un embudo que sí los respeta
  // (17.9K chats contra 748). Mostraban los mismos conceptos que el embudo con
  // otros números y otras metas, así que se quitaron: el embudo ya tiene cada
  // total, cada tasa con su meta, la facturación y el cash collected.
  const funnel = await calculateFunnel(clientId, period, undefined, contentType, rango ?? undefined)

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
                Cárgalas desde la ficha del cliente → pestaña Analítica → registro de métricas.
              </>
            )}
          </div>
        </Card>
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

// ── Comparación con el período anterior y tendencia semanal. Su propio
// Suspense: el embudo se muestra sin esperar estas consultas. Sigue el período
// y el filtro elegidos arriba, así que su key los incluye. ──────────────────

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

async function ComparisonSection({ clientId, contentType, actual, anterior }: {
  clientId: string
  contentType?: ContentTypeFilter
  actual: Rango
  anterior: Rango
}) {
  const [monthComparison, weeklyTrend] = await Promise.all([
    getComparacionDePeriodos(clientId, actual, anterior, contentType),
    getComputedClientMetrics(clientId, 'weekly', 8, contentType),
  ])
  const etiqueta = contentType === 'reel' ? 'Reels' : contentType === 'story' ? 'Historias' : undefined

  return (
    <div className="space-y-8">
      <MonthComparisonCards comparison={monthComparison} contentTypeLabel={etiqueta} />
      <WeeklyTrend weeks={weeklyTrend} contentTypeLabel={etiqueta} />
    </div>
  )
}

// ── Page shell — renders immediately ─────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; type?: string; period?: string; desde?: string; hasta?: string }>
}) {
  const { client: clientId, type, period: periodParam, desde, hasta } = await searchParams
  const rango = leerRango(periodParam, desde, hasta)
  const contentType: ContentTypeFilter | undefined = type === 'reel' || type === 'story' ? type : undefined
  const period: FunnelPeriodType = VALID_PERIODS.includes(periodParam as FunnelPeriodType)
    ? (periodParam as FunnelPeriodType)
    : 'weekly'
  // Los mismos días que mira el embudo, y el período anterior del mismo largo
  // para la comparativa.
  const actual: Rango = rango
    ? { start: rango.start, end: rango.end < hoyChile().iso ? rango.end : hoyChile().iso }
    : periodBounds(period)
  const anterior = periodoAnterior(rango ? 'custom' : period, actual)

  // Only clients is fast — health alerts run one funnel calculation per
  // active client and stream in behind their own Suspense below instead.
  const clients = await getClientOptions()

  return (
    <div className="stagger-children space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">Salud del funnel y métricas de conversión</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodToggle selected={rango ? 'custom' : periodParam} desde={rango?.start} hasta={rango?.end} />
          <ContentTypeToggle selected={type} />
          <ClientSelector clients={clients} selectedId={clientId} />
        </div>
      </div>

      {/* Agency-wide health overview — only in the "no client picked yet"
          landing state. Once a client is selected its funnel is already
          shown in full detail below, so computing every OTHER active
          client's funnel here too would be pure waste. */}
      {!clientId && (
        <Suspense fallback={<HealthAlertsSkeleton />}>
          <HealthAlertsSection />
        </Suspense>
      )}

      {/* Per-client: streams in behind a skeleton, key resets on client switch.
          Two independent Suspense boundaries — switching the period/type
          toggle only re-triggers the funnel one (fast: a couple of queries)
          instead of also waiting on the comparison section's heavier,
          period-irrelevant queries (a 56-day live-metrics scan). */}
      {clientId && (
        <>
          <Suspense key={`${clientId}-${type || 'all'}-${period}-${rango ? `${rango.start}_${rango.end}` : ''}`} fallback={<FunnelSkeleton />}>
            <ClientDetail clientId={clientId} clients={clients} contentType={contentType} period={period} rango={rango} />
          </Suspense>
          <Suspense key={`${clientId}-${type || 'all'}-${actual.start}_${actual.end}`} fallback={<ComparisonSkeleton />}>
            <ComparisonSection clientId={clientId} contentType={contentType} actual={actual} anterior={anterior} />
          </Suspense>
        </>
      )}
    </div>
  )
}
