import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getClient, getClients } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces, getContentMetricsByClient } from '@/lib/actions/content'
import { getLeadsCount } from '@/lib/actions/leads'
import { getCalls, getCallFolders } from '@/lib/actions/calls'
import { getAgencyUsers } from '@/lib/actions/team'
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
  const isSetter = viewer?.role === 'setter'

  try {
    // The full leads and interactions lists (every column, joined tables)
    // used to be fetched here unconditionally — for a client with thousands
    // of either, that's a dozen-plus paginated round trips before ANY tab
    // could render, even Analítica which touches neither. Only a cheap
    // leads count ships with the initial page now; the CRM tab fetches its
    // own full leads+interactions on demand (CrmTabLazy in crm-tab.tsx),
    // Contenido fetches just interactions (ContentMetricsGrid), and
    // Llamadas fetches just the id/name it needs (ClientCallsList).
    const [client, allClients, campaigns, contentPieces, contentMetrics, leadsCount, calls, callFolders, agendaLeadOptions, agencyUsers, leadFunnel, competitors, competitorReels, contentAnalytics, funnelTotals] = await Promise.all([
      getClient(id),
      getClients(),
      getCampaigns(id),
      getContentPieces(id),
      getContentMetricsByClient(id),
      getLeadsCount(id),
      getCalls(undefined, id),
      getCallFolders(id),
      getAgendaLeadOptions(id),
      getAgencyUsers(id),
      getClientLeadFunnel(id),
      getCompetitors(id),
      getCompetitorReelsByClient(id),
      getContentAnalytics(id),
      getClientFunnelTotals(id),
    ])

    return (
      <Suspense fallback={null}>
        <ClientDetail
          client={client}
          allClients={allClients}
          campaigns={campaigns}
          contentPieces={contentPieces}
          contentMetrics={contentMetrics}
          leadsCount={leadsCount}
          calls={calls}
          callFolders={callFolders}
          agendaLeadOptions={agendaLeadOptions}
          agencyUsers={agencyUsers}
          leadFunnel={leadFunnel}
          competitors={competitors}
          competitorReels={competitorReels}
          contentAnalytics={contentAnalytics}
          funnelTotals={funnelTotals}
          isAdmin={isAdmin}
          isSetter={isSetter}
          currentUserId={authUser?.id}
        />
      </Suspense>
    )
  } catch {
    notFound()
  }
}
