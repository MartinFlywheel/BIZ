import {
  getSetterContext, getCycleProgress, getAgendaGoalProgress,
  getSettersProgress, getMyClientOptions,
} from '@/lib/actions/setter-app'

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

/** Métrica compacta con su barra — la unidad que se repite en la vista de equipo. */
function Metric({ label, current, goal }: { label: string; current: number; goal: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span className="font-mono">{current}/{goal}</span>
      </div>
      <ProgressBar current={current} goal={goal} />
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

  // ── Vista de dirección ────────────────────────────────────────────────────
  // Antes esta pantalla rebotaba a los admins con "mira los reportes en el CRM
  // de escritorio", que es justo lo que no se puede hacer desde el celular.
  // getSettersProgress ya existía para el /reports de escritorio: acá se
  // reutiliza tal cual.
  if (context.isAdmin) {
    if (!context.clientId) {
      const clients = await getMyClientOptions()
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-zinc-400">Selecciona un cliente para ver a su equipo</p>
          <form action="/setter-app/progress" method="GET" className="flex w-full max-w-xs flex-col gap-3">
            <select
              name="client"
              defaultValue=""
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-zinc-100"
            >
              <option value="" disabled>Seleccionar cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              type="submit"
              className="w-full rounded-xl bg-white/[0.09] py-3 text-sm font-semibold text-white"
            >
              Ver progreso
            </button>
          </form>
        </div>
      )
    }

    const equipo = await getSettersProgress(context.clientId)

    // Los que van más atrasados en el mes van arriba: esta pantalla se abre
    // para detectar quién necesita atención, no para leer una lista completa.
    const ordenado = [...equipo].sort((a, b) => {
      const pct = (r: typeof a) =>
        r.cycle.goals.minAgendasMonth > 0
          ? r.agendas.agendasThisMonth / r.cycle.goals.minAgendasMonth
          : 1
      return pct(a) - pct(b)
    })

    return (
      <div className="pt-5">
        <div className="px-4 pb-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{context.clientName}</p>
          <h1 className="pr-12 text-xl font-semibold text-white">Progreso del equipo</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {ordenado.length} setter{ordenado.length === 1 ? '' : 's'} · ciclo en curso
          </p>
        </div>

        <div className="space-y-4 px-4 pb-10">
          {ordenado.length === 0 && (
            <p className="pt-6 text-center text-sm text-zinc-600">
              Este cliente no tiene setters asignados.
            </p>
          )}

          {ordenado.map((s) => {
            const cumpleMes = s.agendas.agendasThisMonth >= s.cycle.goals.minAgendasMonth
            return (
              <div key={s.userId} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-white">
                    {s.fullName ?? 'Sin nombre'}
                  </p>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                      cumpleMes
                        ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-400'
                        : 'border-amber-900/40 bg-amber-950/30 text-amber-400'
                    }`}
                  >
                    {cumpleMes ? 'Al día' : 'Bajo la meta'}
                  </span>
                </div>

                <div className="space-y-3">
                  <Metric
                    label="Leads tocados (ciclo)"
                    current={s.cycle.leadsTouched}
                    goal={s.cycle.goals.minLeadsTouched}
                  />
                  {s.agendas.isWeekday && (
                    <Metric
                      label="Agendas hoy"
                      current={s.agendas.agendasToday}
                      goal={s.cycle.goals.minAgendasDay}
                    />
                  )}
                  <Metric
                    label="Agendas esta semana"
                    current={s.agendas.agendasThisWeek}
                    goal={s.cycle.goals.minAgendasWeek}
                  />
                  <Metric
                    label="Agendas este mes"
                    current={s.agendas.agendasThisMonth}
                    goal={s.cycle.goals.minAgendasMonth}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Vista personal del setter ─────────────────────────────────────────────
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
                <span>Hoy</span>
                {agendaGoals.isWeekday ? (
                  <span className="font-mono">{agendaGoals.agendasToday}/{progress.goals.minAgendasDay}</span>
                ) : (
                  <span className="text-zinc-600">Sin mínimo (fin de semana)</span>
                )}
              </div>
              {agendaGoals.isWeekday ? (
                <ProgressBar current={agendaGoals.agendasToday} goal={progress.goals.minAgendasDay} />
              ) : (
                <div className="h-2 w-full rounded-full bg-white/[0.03]" />
              )}
            </div>
            <Metric label="Esta semana" current={agendaGoals.agendasThisWeek} goal={progress.goals.minAgendasWeek} />
            <Metric label="Este mes" current={agendaGoals.agendasThisMonth} goal={progress.goals.minAgendasMonth} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="mb-3 text-sm font-medium text-zinc-300">Seguimientos por etapa (ciclo actual)</p>
          <div className="space-y-3">
            {progress.followupsByStage.map((f) => (
              <Metric key={f.stage} label={f.label} current={f.count} goal={progress.goals.minFollowupsPerStage} />
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
