import { createClient } from '@/lib/supabase/server'
import { Card, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { IntegrationsPanel } from '@/components/settings/integrations-panel'
import { formatDate } from '@/lib/utils'
import { METAS_EMBUDO } from '@/lib/embudo'

export default async function SettingsPage() {
  const supabase = await createClient()

  // Las dos consultas son independientes: en paralelo, no en fila.
  const [{ data: integrations }, { data: syncLogs }] = await Promise.all([
    supabase.from('integrations').select('*').order('platform'),
    supabase
      .from('sync_logs')
      .select('*, integrations(platform, clients(ig_handle))')
      .order('started_at', { ascending: false })
      .limit(20),
  ])

  const AREA: Record<string, string> = { content: 'Contenido', setting: 'Setting', closing: 'Closing' }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">Configuración</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Integraciones, metas del embudo y logs de sincronización
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IntegrationsPanel integrations={integrations || []} />

        {/* Las metas que usan el embudo del Dashboard y el aviso diario
            (src/lib/embudo.ts). Antes esta tarjeta mostraba la tabla
            `benchmarks`, con otras cifras que el embudo no usaba. */}
        <Card>
          <CardTitle>Metas del embudo</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Bajo la meta, la tasa sale en rojo en el Dashboard y se avisa cada mañana al responsable del área (últimos 15 días).
          </p>
          <div className="mt-4 space-y-3">
            {METAS_EMBUDO.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 transition-all duration-300 hover:border-white/[0.08]">
                <div>
                  <p className="text-sm text-white/90">Tasa de {m.label.toLowerCase()}</p>
                  <p className="text-xs text-zinc-500">
                    {m.formula} · {AREA[m.area] ?? m.area}
                  </p>
                </div>
                <span className="font-mono text-sm font-medium text-white/90">
                  {m.min}–{m.max}%
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
