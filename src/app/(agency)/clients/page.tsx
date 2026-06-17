import { getClients } from '@/lib/actions/clients'
import { ClientsList } from '@/components/clients/clients-list'

export default async function ClientsPage() {
  const clients = await getClients()

  return (
    <div className="space-y-6">
      <ClientsList clients={clients} />
    </div>
  )
}
