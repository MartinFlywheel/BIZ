import { getClients } from '@/lib/actions/clients'
import { getSessionProfile } from '@/lib/supabase/session'
import { ClientsList } from '@/components/clients/clients-list'

export default async function ClientsPage() {
  // El perfil ya lo pidió el layout en este mismo render: se reutiliza en vez
  // de volver a validar la sesión, y la lista de clientes va en paralelo.
  const [viewer, clients] = await Promise.all([getSessionProfile(), getClients()])
  // Mismo criterio que el detalle del cliente: solo un admin de la agencia
  // puede borrar, y el server action lo vuelve a verificar.
  const isAdmin = viewer?.user_type === 'agency' && viewer?.role === 'admin'

  return (
    <div className="space-y-6">
      <ClientsList clients={clients} isAdmin={isAdmin} />
    </div>
  )
}
