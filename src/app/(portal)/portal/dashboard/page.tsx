import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces, getContentMetricsByClient } from '@/lib/actions/content'
import { getLeads } from '@/lib/actions/leads'
import { getCalls, getCallFolders } from '@/lib/actions/calls'
import { getInteractions } from '@/lib/actions/interactions'
import { getClientLeadFunnel } from '@/lib/actions/lead-funnel'
import { getCompetitors, getCompetitorReelsByClient } from '@/lib/actions/competitors'
import { getContentAnalytics } from '@/lib/actions/content-analytics'
import { getClientFunnelTotals } from '@/lib/actions/metrics'
import { getAgendaLeadOptions } from '@/lib/actions/agenda-records'
import { ClientDetail } from '@/components/clients/client-detail'

export default async function PortalDashboardPage() {
  unstable_noStore()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('client_id')
    .eq('id', user.id)
    .single()

  if (!profile?.client_id) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-500">Tu cuenta no tiene un cliente asignado. Contactá a la agencia.</p>
      </div>
    )
  }

  const clientId = profile.client_id

  const [
    client,
    campaigns,
    contentPieces,
    contentMetrics,
    leads,
    calls,
    callFolders,
    agendaLeadOptions,
    interactions,
    leadFunnel,
    competitors,
    competitorReels,
    contentAnalytics,
    funnelTotals,
  ] = await Promise.all([
    getClient(clientId),
    getCampaigns(clientId),
    getContentPieces(clientId),
    getContentMetricsByClient(clientId),
    getLeads(clientId),
    getCalls(),
    getCallFolders(clientId),
    getAgendaLeadOptions(clientId),
    getInteractions(clientId),
    getClientLeadFunnel(clientId),
    getCompetitors(clientId),
    getCompetitorReelsByClient(clientId),
    getContentAnalytics(clientId),
    getClientFunnelTotals(clientId),
  ])

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
        agencyUsers={[]}
        interactions={interactions}
        leadFunnel={leadFunnel}
        competitors={competitors}
        competitorReels={competitorReels}
        contentAnalytics={contentAnalytics}
        funnelTotals={funnelTotals}
        readOnly
      />
    </Suspense>
  )
}
