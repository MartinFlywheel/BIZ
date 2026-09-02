import { redirect } from 'next/navigation'
import { getSetterContext, getMyAgendas, getCycleProgress } from '@/lib/actions/setter-app'
import { AgendaList } from '@/components/setter-app/agenda-list'
import { MonthNav } from '@/components/setter-app/month-nav'

/** Devuelve el mes pedido por query string, o el actual si no vino o es basura. */
function resolvePeriod(y?: string, m?: string): { year: number; month: number } {
  const now = new Date()
  const year = Number(y)
  const month = Number(m)
  const valido =
    Number.isInteger(year) && year >= 2020 && year <= 2100 &&
    Number.isInteger(month) && month >= 1 && month <= 12
  return valido
    ? { year, month }
    : { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export default async function SetterAgendasPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; y?: string; m?: string }>
}) {
  const { client: requestedClientId, y, m } = await searchParams
  const context = await getSetterContext(requestedClientId)

  if (!context) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        No se pudo cargar tu sesión. Vuelve a iniciar sesión.
      </div>
    )
  }

  if (!context.clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        {context.isAdmin
          ? 'Selecciona un cliente primero desde la pestaña Leads.'
          : 'Tu cuenta no tiene un cliente asignado. Contacta a un administrador.'}
      </div>
    )
  }

  if (!context.isAdmin) {
    const progress = await getCycleProgress(context.userId, context.clientId)
    if (progress.needsReport) redirect('/setter-app/report')
  }

  const period = resolvePeriod(y, m)
  const setterId = context.isAdmin ? null : context.userId
  const agendas = await getMyAgendas(context.clientId, setterId, context.fullName, period)

  return (
    <div className="pt-5">
      <div className="px-4 pb-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{context.clientName}</p>
        <h1 className="pr-12 text-xl font-semibold text-white">Agendas</h1>
      </div>

      <MonthNav
        basePath="/setter-app/agendas"
        year={period.year}
        month={period.month}
        clientId={requestedClientId ?? null}
        total={agendas.length}
      />

      {agendas.length === 0 ? (
        <p className="px-4 pt-6 text-center text-sm text-zinc-600">
          Sin agendas este mes.
        </p>
      ) : (
        <AgendaList agendas={agendas} />
      )}
    </div>
  )
}
