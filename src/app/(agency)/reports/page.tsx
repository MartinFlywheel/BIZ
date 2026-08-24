import { getDailySetterReports } from '@/lib/actions/setter-app'
import { Card, CardTitle } from '@/components/ui/card'
import { formatDateCompact } from '@/lib/utils'

export default async function ReportsPage() {
  const reports = await getDailySetterReports()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white/90">Reportes de Setters</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Reporte de cierre de ciclo que cada setter completa al llegar a su cuota diaria de leads tocados.
        </p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <div className="flex h-32 items-center justify-center text-center text-sm text-zinc-500">
            Todavía no hay reportes enviados.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id} className="glass-interactive">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-zinc-200">
                    {r.setterName ?? 'Setter'} · {r.clientName ?? 'Cliente'}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-zinc-500">{formatDateCompact(r.submittedAt)}</p>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <p className="font-mono text-lg font-semibold text-white">{r.leadsTouched}</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Tocados</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold text-emerald-400">{r.agendasSet}</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Agendas</p>
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold text-amber-400">{r.followupsTotal}</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Seguim.</p>
                  </div>
                </div>
              </div>

              {(r.commonObjections || r.marketingFeedback) && (
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-2">
                  {r.commonObjections && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Objeciones</p>
                      <p className="text-xs text-zinc-400 leading-relaxed">{r.commonObjections}</p>
                    </div>
                  )}
                  {r.marketingFeedback && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Feedback de marketing</p>
                      <p className="text-xs text-zinc-400 leading-relaxed">{r.marketingFeedback}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
