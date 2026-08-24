import { redirect } from 'next/navigation'
import { getSetterContext, getMyAgendas, getCycleProgress } from '@/lib/actions/setter-app'
import { AgendaList } from '@/components/setter-app/agenda-list'

export default async function SetterAgendasPage({
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

  const setterId = context.isAdmin ? null : context.userId
  const agendas = await getMyAgendas(context.clientId, setterId, context.fullName)

  return (
    <div className="pt-5">
      <div className="px-4 pb-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{context.clientName}</p>
        <h1 className="pr-12 text-xl font-semibold text-white">Agendas</h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          {agendas.length} llamada{agendas.length === 1 ? '' : 's'}
        </p>
      </div>

      <AgendaList agendas={agendas} />
    </div>
  )
}
