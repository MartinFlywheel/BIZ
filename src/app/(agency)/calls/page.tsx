import { getCalls } from '@/lib/actions/calls'
import { getLeadOptions } from '@/lib/actions/leads'
import { getAgencyUsers } from '@/lib/actions/team'
import { CallsList } from '@/components/calls/calls-list'

export default async function CallsPage() {
  const [calls, leads, users] = await Promise.all([
    getCalls(),
    getLeadOptions(),
    getAgencyUsers(),
  ])

  return (
    <div className="space-y-6">
      <CallsList
        calls={calls as any}
        leads={leads}
        callers={users.map((u) => ({ id: u.id, full_name: u.full_name }))}
      />
    </div>
  )
}
