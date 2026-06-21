import { unstable_noStore } from 'next/cache'
import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces, getContentMetricsByClient } from '@/lib/actions/content'
import { getLeads } from '@/lib/actions/leads'
import { getCalls } from '@/lib/actions/calls'
import { getAgencyUsers } from '@/lib/actions/team'
import { getInteractions } from '@/lib/actions/interactions'
import { getClientLeadFunnel } from '@/lib/actions/lead-funnel'
import { getCompetitors, getCompetitorReelsByClient } from '@/lib/actions/competitors'
import { getContentAnalytics } from '@/lib/actions/content-analytics'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  unstable_noStore()

  try {
    const [client, campaigns, contentPieces, contentMetrics, leads, calls, agencyUsers, interactions, leadFunnel, competitors, competitorReels, contentAnalytics] = await Promise.all([
      getClient(id),
      getCampaigns(id),
      getContentPieces(id),
      getContentMetricsByClient(id),
      getLeads(id),
      getCalls(),
      getAgencyUsers(),
      getInteractions(id),
      getClientLeadFunnel(id),
      getCompetitors(id),
      getCompetitorReelsByClient(id),
      getContentAnalytics(id),
    ])

    // Filter calls by client: only calls whose lead belongs to this client
    const clientLeadIds = new Set(leads.map((l: { id: string }) => l.id))
    const clientCalls = calls.filter((c: { lead_id: string }) => clientLeadIds.has(c.lead_id))

    return (
      <ClientDetail
        client={client}
        campaigns={campaigns}
        contentPieces={contentPieces}
        contentMetrics={contentMetrics}
        leads={leads}
        calls={clientCalls}
        agencyUsers={agencyUsers}
        interactions={interactions}
        leadFunnel={leadFunnel}
        competitors={competitors}
        competitorReels={competitorReels}
        contentAnalytics={contentAnalytics}
      />
    )
  } catch {
    notFound()
  }
}
