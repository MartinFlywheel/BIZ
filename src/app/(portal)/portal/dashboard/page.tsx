import { createClient } from '@/lib/supabase/server'
import { getDashboardMetrics, getBenchmarkAlerts } from '@/lib/actions/metrics'
import { MetricCard } from '@/components/dashboard/metric-card'
import { Card } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/utils'
import { redirect } from 'next/navigation'

export default async function PortalDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('client_id')
    .eq('id', user.id)
    .single()

  if (!profile?.client_id) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">Mi Dashboard</h1>
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            Tu cuenta no tiene un cliente asignado. Contacta a la agencia.
          </div>
        </Card>
      </div>
    )
  }

  const { data: client } = await supabase
    .from('clients')
    .select('name, ig_handle')
    .eq('id', profile.client_id)
    .single()

  const metrics = await getDashboardMetrics(profile.client_id)
  const alerts = await getBenchmarkAlerts(profile.client_id, metrics)
  const alertMap = Object.fromEntries(alerts.map((a) => [a.metric_key, a]))

  return (
    <div className="stagger-children space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">
          {client?.name || 'Mi Dashboard'}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{client?.ig_handle}</p>
      </div>

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
          alert={alertMap['tasa_respuesta']}
        />
        <MetricCard
          title="Tasa de Show-up"
          value={formatPercent(metrics.tasa_show_up)}
          alert={alertMap['tasa_show_up']}
        />
        <MetricCard
          title="Tasa de Cierre"
          value={formatPercent(metrics.tasa_cierre)}
          alert={alertMap['tasa_cierre']}
        />
      </div>
    </div>
  )
}
