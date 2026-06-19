import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces } from '@/lib/actions/content'
import { getInteractions } from '@/lib/actions/interactions'
import { getTeamAssignments, getAgencyUsers } from '@/lib/actions/team'
import { getClientMetrics } from '@/lib/actions/funnel'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'
import type { ClientMetrics } from '@/lib/types'


export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  try {
    const [client, campaigns, contentPieces, interactions, teamAssignments, agencyUsers, metrics] = await Promise.all([
      getClient(id),
      getCampaigns(id),
      getContentPieces(id),
      getInteractions(id),
      getTeamAssignments(id),
      getAgencyUsers(),
      getClientMetrics(id, 'weekly'),
    ])

    return (
      <ClientDetail
        client={client}
        campaigns={campaigns}
        contentPieces={contentPieces}
        interactions={interactions}
        teamAssignments={teamAssignments as any}
        agencyUsers={agencyUsers}
        metrics={(metrics ?? []) as ClientMetrics[]}
      />
    )

  } catch {
    notFound()
  }
}
