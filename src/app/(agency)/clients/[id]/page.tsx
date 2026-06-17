import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces } from '@/lib/actions/content'
import { getInteractions } from '@/lib/actions/interactions'
import { getTeamAssignments, getAgencyUsers } from '@/lib/actions/team'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  try {
    const [client, campaigns, contentPieces, interactions, teamAssignments, agencyUsers] = await Promise.all([
      getClient(id),
      getCampaigns(id),
      getContentPieces(id),
      getInteractions(id),
      getTeamAssignments(id),
      getAgencyUsers(),
    ])

    return (
      <ClientDetail
        client={client}
        campaigns={campaigns}
        contentPieces={contentPieces}
        interactions={interactions}
        teamAssignments={teamAssignments as any}
        agencyUsers={agencyUsers}
      />
    )
  } catch {
    notFound()
  }
}
