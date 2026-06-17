import { getLeads } from '@/lib/actions/leads'
import { getClients } from '@/lib/actions/clients'
import { LeadsPipeline } from '@/components/leads/leads-pipeline'
import { LeadsFilter } from '@/components/leads/leads-filter'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: filterClient } = await searchParams
  const [leads, clients] = await Promise.all([getLeads(), getClients()])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Pipeline de Ventas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {leads.length} lead{leads.length !== 1 ? 's' : ''} en pipeline
          </p>
        </div>
        <LeadsFilter clients={clients} selectedClient={filterClient || ''} />
      </div>

      <LeadsPipeline leads={leads as any} filterClient={filterClient || ''} />
    </div>
  )
}
