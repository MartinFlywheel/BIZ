import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces, getContentMetricsByClient } from '@/lib/actions/content'
import { getLeads } from '@/lib/actions/leads'
import { getCalls, getCallFolders } from '@/lib/actions/calls'
import { getAgencyUsers } from '@/lib/actions/team'
import { getInteractions } from '@/lib/actions/interactions'
import { getClientLeadFunnel } from '@/lib/actions/lead-funnel'
import { getCompetitors, getCompetitorReelsByClient } from '@/lib/actions/competitors'
import { getContentAnalytics } from '@/lib/actions/content-analytics'
import { getClientFunnelTotals } from '@/lib/actions/metrics'
import { getAgendaLeadOptions } from '@/lib/actions/agenda-records'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  unstable_noStore()

  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: viewer } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = viewer?.role === 'admin'

  try {
    const [client, campaigns, contentPieces, contentMetrics, leads, calls, callFolders, agendaLeadOptions, agencyUsers, interactions, leadFunnel, competitors, competitorReels, contentAnalytics, funnelTotals] = await Promise.all([
      getClient(id),
      getCampaigns(id),
      getContentPieces(id),
      getContentMetricsByClient(id),
      getLeads(id),
      getCalls(),
      getCallFolders(id),
      getAgendaLeadOptions(id),
      getAgencyUsers(id),
      getInteractions(id),
      getClientLeadFunnel(id),
      getCompetitors(id),
      getCompetitorReelsByClient(id),
      getContentAnalytics(id),
      getClientFunnelTotals(id),
    ])

    // Filter calls by client: only calls whose lead belongs to this client
    const clientLeadIds = new Set(leads.map((l: { id: string }) => l.id))
    const clientCalls = calls.filter((c: { lead_id: string }) => clientLeadIds.has(c.lead_id))

    return (
      <Suspense fallback={null}>
        <ClientDetail
          client={client}
          campaigns={campaigns}
          contentPieces={contentPieces}
          contentMetrics={contentMetrics}
          leads={leads}
          calls={clientCalls}
          callFolders={callFolders}
          agendaLeadOptions={agendaLeadOptions}
          agencyUsers={agencyUsers}
          interactions={interactions}
          leadFunnel={leadFunnel}
          competitors={competitors}
          competitorReels={competitorReels}
          contentAnalytics={contentAnalytics}
          funnelTotals={funnelTotals}
          isAdmin={isAdmin}
          currentUserId={authUser?.id}
        />
      </Suspense>
    )
  } catch {
    notFound()
  }
}
