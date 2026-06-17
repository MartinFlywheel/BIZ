import { createClient } from '@/lib/supabase/server'
import { Card, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { IntegrationsPanel } from '@/components/settings/integrations-panel'
import { formatDate } from '@/lib/utils'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: integrations } = await supabase
    .from('integrations')
    .select('*')
    .order('platform')

  const { data: benchmarks } = await supabase
    .from('benchmarks')
    .select('*, clients(name)')
    .order('metric_key')

  const { data: syncLogs } = await supabase
    .from('sync_logs')
    .select('*, integrations(platform, clients(ig_handle))')
    .order('started_at', { ascending: false })
    .limit(20)

  const metricLabels: Record<string, string> = {
    tasa_respuesta: 'Tasa de Respuesta',
    tasa_show_up: 'Tasa de Show-up',
    tasa_cierre: 'Tasa de Cierre',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">Configuración</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Integraciones, benchmarks y logs de sincronización
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IntegrationsPanel integrations={integrations || []} />

        <Card>
          <CardTitle>Benchmarks</CardTitle>
          <div className="mt-4 space-y-3">
            {benchmarks?.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 transition-all duration-300 hover:border-white/[0.08]">
                <div>
                  <p className="text-sm text-white/90">
                    {metricLabels[b.metric_key] || b.metric_key}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {(b as any).clients?.name || 'Global'} · {b.responsible_area || '—'}
                  </p>
                </div>
                <span className="font-mono text-sm font-medium text-white/90">
                  {b.comparison === 'gte' ? '≥' : '≤'} {b.threshold_value}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Logs de Sincronización</CardTitle>
        <div className="mt-4">
          {(!syncLogs || syncLogs.length === 0) ? (
            <p className="text-sm text-zinc-500">Sin logs todavía</p>
          ) : (
            <div className="space-y-2">
              {syncLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-xl border-b border-white/[0.05] pb-3 text-sm">
                  <div>
                    <span className="text-zinc-300">
                      {(log as any).integrations?.platform} — {log.sync_type}
                    </span>
                    {log.error && (
                      <p className="text-xs text-red-400/80">{log.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      log.status === 'completed' ? 'success' :
                      log.status === 'failed' ? 'danger' : 'warning'
                    }>
                      {log.status}
                    </Badge>
                    <span className="font-mono text-xs text-zinc-500">
                      {log.records_processed} reg.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
