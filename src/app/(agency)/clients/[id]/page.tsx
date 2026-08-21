import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getClient, getClients } from '@/lib/actions/clients'
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
  const isSetter = viewer?.role === 'setter'

  try {
    const [client, allClients, campaigns, contentPieces, contentMetrics, leads, calls, callFolders, agendaLeadOptions, agencyUsers, interactions, leadFunnel, competitors, competitorReels, contentAnalytics, funnelTotals] = await Promise.all([
      getClient(id),
      getClients(),
      getCampaigns(id),
      getContentPieces(id),
      getContentMetricsByClient(id),
      getLeads(id),
      getCalls(undefined, id),
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

    // Only the lead_calificado node's leads get split up per-setter — chat
    // abierto and conversación real (agendamiento) stay exactly as they
    // were, visible to every setter on the team, since those still need
    // whoever's free to work them. A qualified lead assigned to someone
    // else is the only thing hidden from a setter here; unassigned or
    // earlier-stage leads (including manually created ones with no linked
    // interaction) show to everyone same as before.
    const visibleLeads = isSetter
      ? leads.filter((lead) => {
          const classification = (lead as { interactions?: { classification?: string } | null }).interactions?.classification
          const isQualifiedForSomeoneElse = classification === 'lead_calificado' && lead.assigned_to && lead.assigned_to !== authUser?.id
          return !isQualifiedForSomeoneElse
        })
      : leads

    return (
      <Suspense fallback={null}>
        <ClientDetail
          client={client}
          allClients={allClients}
          campaigns={campaigns}
          contentPieces={contentPieces}
          contentMetrics={contentMetrics}
          leads={visibleLeads}
          calls={calls}
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
          isSetter={isSetter}
          currentUserId={authUser?.id}
        />
      </Suspense>
    )
  } catch {
    notFound()
  }
}
