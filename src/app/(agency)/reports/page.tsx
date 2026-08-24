import { getDailySetterReports, getSettersProgress } from '@/lib/actions/setter-app'
import { getClients } from '@/lib/actions/clients'
import { Card, CardTitle } from '@/components/ui/card'
import { formatDateCompact } from '@/lib/utils'
import { ReportsClientPicker } from '@/components/reports/client-picker'

function ProgressBar({ current, goal }: { current: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0
  const met = current >= goal
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full transition-all ${met ? 'bg-emerald-500' : 'bg-amber-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: clientId } = await searchParams
  const [clients, reports, settersProgress] = await Promise.all([
    getClients(),
    getDailySetterReports(clientId),
    clientId ? getSettersProgress(clientId) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Reportes de Setters</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Progreso en vivo del ciclo actual, y el reporte que cada setter completa al cerrarlo.
          </p>
        </div>
        <ReportsClientPicker clients={clients} selectedId={clientId} />
      </div>

      {/* ── Live progress — only meaningful scoped to one client, since a ── */}
      {/* setter's cycle/goals are per client. ─────────────────────────── */}
      {!clientId ? (
        <Card>
          <div className="flex h-24 items-center justify-center text-center text-sm text-zinc-500">
            Selecciona un cliente arriba para ver el progreso en vivo de sus setters.
          </div>
        </Card>
      ) : settersProgress && settersProgress.length === 0 ? (
        <Card>
          <div className="flex h-24 items-center justify-center text-center text-sm text-zinc-500">
            Este cliente no tiene setters asignados todavía.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-white/90">Progreso en vivo</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {settersProgress?.map((s) => (
              <Card key={s.userId} className="glass-interactive">
                <CardTitle className="text-zinc-200">{s.fullName ?? 'Setter'}</CardTitle>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
                      <span>Leads tocados (ciclo)</span>
                      <span className="font-mono">{s.cycle.leadsTouched}/{s.cycle.goals.minLeadsTouched}</span>
                    </div>
                    <ProgressBar current={s.cycle.leadsTouched} goal={s.cycle.goals.minLeadsTouched} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="mb-1 flex items-baseline justify-between text-[11px] text-zinc-500">
                        <span>Agendas semana</span>
                        <span className="font-mono">{s.agendas.agendasThisWeek}/{s.cycle.goals.minAgendasWeek}</span>
                      </div>
                      <ProgressBar current={s.agendas.agendasThisWeek} goal={s.cycle.goals.minAgendasWeek} />
                    </div>
                    <div>
                      <div className="mb-1 flex items-baseline justify-between text-[11px] text-zinc-500">
                        <span>Agendas mes</span>
                        <span className="font-mono">{s.agendas.agendasThisMonth}/{s.cycle.goals.minAgendasMonth}</span>
                      </div>
                      <ProgressBar current={s.agendas.agendasThisMonth} goal={s.cycle.goals.minAgendasMonth} />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] text-zinc-500">Seguimientos por etapa</p>
                    <div className="grid grid-cols-2 gap-2">
                      {s.cycle.followupsByStage.map((f) => (
                        <div key={f.stage} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
                          <div className="flex items-baseline justify-between text-[10px] text-zinc-500">
                            <span>{f.label}</span>
                            <span className="font-mono">{f.count}/{s.cycle.goals.minFollowupsPerStage}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Submitted reports ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-white/90">Reportes enviados</h2>
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
    </div>
  )
}
