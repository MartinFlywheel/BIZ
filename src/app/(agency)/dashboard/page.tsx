import { getClients } from '@/lib/actions/clients'
import { checkHealthAlerts, calculateFunnel } from '@/lib/actions/funnel'
import { getDashboardMetrics, getBenchmarkAlerts } from '@/lib/actions/metrics'
import { MetricCard } from '@/components/dashboard/metric-card'
import { HealthAlerts } from '@/components/dashboard/health-alerts'
import { FunnelView } from '@/components/dashboard/funnel-view'
import { ClientSelector } from '@/components/dashboard/client-selector'
import { Card } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/utils'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: clientId } = await searchParams
  const [clients, healthAlerts] = await Promise.all([
    getClients(),
    checkHealthAlerts('weekly'),
  ])

  const selectedClient = clientId ? clients.find((c) => c.id === clientId) : null

  // Snapshot-based funnel (weekly client_metrics) for the selected client
  const funnel = clientId ? await calculateFunnel(clientId, 'weekly') : null

  // Live CRM metrics (interactions / leads / content) for the selected client
  let liveMetrics = null
  let alerts: Awaited<ReturnType<typeof getBenchmarkAlerts>> = []
  if (clientId) {
    liveMetrics = await getDashboardMetrics(clientId)
    alerts = await getBenchmarkAlerts(clientId, liveMetrics)
  }
  const alertMap = Object.fromEntries(alerts.map((a) => [a.metric_key, a]))

  return (
    <div className="stagger-children space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Salud del funnel y métricas de conversión
          </p>
        </div>
        <ClientSelector clients={clients} selectedId={clientId} />
      </div>

      {/* Agency-wide health overview — always visible */}
      <HealthAlerts alerts={healthAlerts} selectedId={clientId} />

      {/* Per-client detail — only when a client is selected */}
      {clientId && selectedClient && (
        <div className="stagger-children space-y-8">
          {funnel ? (
            <FunnelView funnel={funnel} clientName={selectedClient.name} />
          ) : (
            <Card>
              <div className="flex h-32 items-center justify-center text-center text-sm text-zinc-500">
                {selectedClient.name} aún no tiene métricas semanales cargadas.
                <br />
                Cárgalas desde la ficha del cliente → pestaña Métricas.
              </div>
            </Card>
          )}

          {/* Live CRM metrics derived from interactions/leads/content */}
          {liveMetrics && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-white/90">Métricas en Vivo (CRM)</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard title="Views" value={formatNumber(liveMetrics.total_views)} />
                <MetricCard title="Chats Nuevos" value={formatNumber(liveMetrics.chats_abiertos)} />
                <MetricCard title="Conv. Reales" value={formatNumber(liveMetrics.conversaciones_reales)} />
                <MetricCard title="Agendas" value={formatNumber(liveMetrics.agendas)} />
                <MetricCard title="Cierres" value={formatNumber(liveMetrics.cierres)} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <MetricCard
                  title="Tasa de Respuesta"
                  value={formatPercent(liveMetrics.tasa_respuesta)}
                  subtitle="Conv. Reales / Chats Nuevos"
                  alert={alertMap['tasa_respuesta']}
                />
                <MetricCard
                  title="Tasa de Show-up"
                  value={formatPercent(liveMetrics.tasa_show_up)}
                  subtitle="Show-ups / Agendas"
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
      )}
    </div>
  )
}
