import { getSetterContext, getMyActiveLeads, getMyClientOptions } from '@/lib/actions/setter-app'
import { LeadList } from '@/components/setter-app/lead-list'
import { LogoutButton } from '@/components/setter-app/logout-button'

export default async function SetterAppPage({
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

  // A non-admin with no client_id assigned yet has nowhere to go — showing
  // them the client picker below would let them browse any client's leads,
  // breaking the one-setter-one-client confinement the rest of the app
  // enforces (middleware, /clients/{id}, getLeadsForViewer).
  if (!context.clientId && !context.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        Tu cuenta no tiene un cliente asignado. Contacta a un administrador.
      </div>
    )
  }

  // Admin with no client picked yet — team members always have one client_id
  // and skip straight to their own leads, no picker needed.
  if (!context.clientId) {
    const clients = await getMyClientOptions()
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-zinc-400">Selecciona un cliente para ver sus leads</p>
        <form action="/setter-app" method="GET" className="flex w-full max-w-xs flex-col gap-3">
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
            Ver leads
          </button>
        </form>
      </div>
    )
  }

  // Admin: oversight view, every setter's active leads for this client.
  // Everyone else: just their own caseload.
  const setterId = context.isAdmin ? null : context.userId
  const { leads, hasMore } = await getMyActiveLeads(context.clientId, setterId, 0)

  return (
    <div className="pt-5">
      <div className="flex items-start justify-between px-4 pb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500">{context.clientName ?? 'Mis leads'}</p>
          <h1 className="text-xl font-semibold text-white">
            {context.isAdmin ? 'Todos los leads' : `Hola, ${context.fullName?.split(' ')[0] ?? 'setter'}`}
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {leads.length}{hasMore ? '+' : ''} lead{leads.length === 1 ? '' : 's'} activo{leads.length === 1 ? '' : 's'}
          </p>
        </div>
        <LogoutButton />
      </div>

      <LeadList
        clientId={context.clientId}
        setterId={setterId}
        initialLeads={leads}
        initialHasMore={hasMore}
      />
    </div>
  )
}
