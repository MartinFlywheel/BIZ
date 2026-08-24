import { getSetterContext, getCycleProgress, getAgendaGoalProgress } from '@/lib/actions/setter-app'

function ProgressBar({ current, goal }: { current: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0
  const met = current >= goal
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full transition-all ${met ? 'bg-emerald-500' : 'bg-amber-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default async function SetterProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: requestedClientId } = await searchParams
  const context = await getSetterContext(requestedClientId)

  if (!context) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        No se pudo cargar tu sesión. Vuelve a iniciar sesión.
      </div>
    )
  }

  if (context.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        El progreso es una vista personal de cada setter — como admin, mira los reportes en el CRM de escritorio.
      </div>
    )
  }

  if (!context.clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        Tu cuenta no tiene un cliente asignado. Contacta a un administrador.
      </div>
    )
  }

  const [progress, agendaGoals] = await Promise.all([
    getCycleProgress(context.userId, context.clientId),
    getAgendaGoalProgress(context.userId, context.clientId, context.fullName),
  ])

  return (
    <div className="pt-5">
      <div className="px-4 pb-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{context.clientName}</p>
        <h1 className="pr-12 text-xl font-semibold text-white">Tu progreso</h1>
      </div>

      <div className="space-y-4 px-4 pb-10">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-medium text-zinc-300">Leads tocados (ciclo actual)</p>
            <p className="font-mono text-sm text-zinc-400">{progress.leadsTouched}/{progress.goals.minLeadsTouched}</p>
          </div>
          <ProgressBar current={progress.leadsTouched} goal={progress.goals.minLeadsTouched} />
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="mb-3 text-sm font-medium text-zinc-300">Agendas</p>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
                <span>Esta semana</span>
                <span className="font-mono">{agendaGoals.agendasThisWeek}/{progress.goals.minAgendasWeek}</span>
              </div>
              <ProgressBar current={agendaGoals.agendasThisWeek} goal={progress.goals.minAgendasWeek} />
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
                <span>Este mes</span>
                <span className="font-mono">{agendaGoals.agendasThisMonth}/{progress.goals.minAgendasMonth}</span>
              </div>
              <ProgressBar current={agendaGoals.agendasThisMonth} goal={progress.goals.minAgendasMonth} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="mb-3 text-sm font-medium text-zinc-300">Seguimientos por etapa (ciclo actual)</p>
          <div className="space-y-3">
            {progress.followupsByStage.map((f) => (
              <div key={f.stage}>
                <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
                  <span>{f.label}</span>
                  <span className="font-mono">{f.count}/{progress.goals.minFollowupsPerStage}</span>
                </div>
                <ProgressBar current={f.count} goal={progress.goals.minFollowupsPerStage} />
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-zinc-600">
          Al llegar a {progress.goals.minLeadsTouched} leads tocados se abre el reporte de cierre de ciclo.
        </p>
      </div>
    </div>
  )
}
