import { getClients } from '@/lib/actions/clients'
import { getDashboardMetrics, getBenchmarkAlerts } from '@/lib/actions/metrics'
import { MetricCard } from '@/components/dashboard/metric-card'
import { ClientSelector } from '@/components/dashboard/client-selector'
import { Card } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/utils'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: clientId } = await searchParams
  const clients = await getClients()

  let metrics = null
  let alerts: Awaited<ReturnType<typeof getBenchmarkAlerts>> = []

  if (clientId) {
    metrics = await getDashboardMetrics(clientId)
    alerts = await getBenchmarkAlerts(clientId, metrics)
  }

  const alertMap = Object.fromEntries(alerts.map((a) => [a.metric_key, a]))

  return (
    <div className="stagger-children space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Métricas de captación y conversión
          </p>
        </div>
        <ClientSelector clients={clients} selectedId={clientId} />
      </div>

      {!clientId ? (
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            Selecciona un cliente para ver sus métricas
          </div>
        </Card>
      ) : !metrics ? (
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            Sin datos para este cliente
          </div>
        </Card>
      ) : (
        <div className="stagger-children space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard title="Views" value={formatNumber(metrics.total_views)} />
            <MetricCard title="Chats Nuevos" value={formatNumber(metrics.chats_abiertos)} />
            <MetricCard title="Conv. Reales" value={formatNumber(metrics.conversaciones_reales)} />
            <MetricCard title="Agendas" value={formatNumber(metrics.agendas)} />
            <MetricCard title="Cierres" value={formatNumber(metrics.cierres)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MetricCard
              title="Tasa de Respuesta"
              value={formatPercent(metrics.tasa_respuesta)}
              subtitle="Conv. Reales / Chats Nuevos"
              alert={alertMap['tasa_respuesta']}
            />
            <MetricCard
              title="Tasa de Show-up"
              value={formatPercent(metrics.tasa_show_up)}
              subtitle="Show-ups / Agendas"
              alert={alertMap['tasa_show_up']}
            />
            <MetricCard
              title="Tasa de Cierre"
              value={formatPercent(metrics.tasa_cierre)}
              subtitle="Cierres / Show-ups"
              alert={alertMap['tasa_cierre']}
            />
          </div>

          {alerts.some((a) => a.is_failing) && (
            <Card className="border-[#ff453a]/25 bg-[#ff453a]/[0.06] p-4">
              <h3 className="mb-2 text-sm font-medium text-red-300/90">Diagnóstico de Cuellos de Botella</h3>
              <div className="space-y-2">
                {alerts.filter((a) => a.is_failing).map((a) => (
                  <div key={a.metric_key} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#ff453a] shadow-[0_0_8px_rgba(255,69,58,0.7)]" />
                    <span className="text-red-300/90">{a.diagnosis_message}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
