import { createClient } from '@/lib/supabase/server'
import { getClients } from '@/lib/actions/clients'
import { ClientsList } from '@/components/clients/clients-list'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: viewer } = authUser
    ? await supabase.from('users').select('role, user_type').eq('id', authUser.id).single()
    : { data: null }
  // Mismo criterio que el detalle del cliente: solo un admin de la agencia
  // puede borrar, y el server action lo vuelve a verificar.
  const isAdmin = viewer?.user_type === 'agency' && viewer?.role === 'admin'

  const clients = await getClients()

  return (
    <div className="space-y-6">
      <ClientsList clients={clients} isAdmin={isAdmin} />
    </div>
  )
}
