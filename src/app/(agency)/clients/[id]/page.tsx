import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getClient, getClientOptions } from '@/lib/actions/clients'
import { getContentPiecesCount } from '@/lib/actions/content'
import { getLeadsCount } from '@/lib/actions/leads'
import { getCallsCount } from '@/lib/actions/calls'
import { getCompetitorsCount } from '@/lib/actions/competitors'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'

// Server Actions invoked from this page's client components (CrmTabLazy's
// getLeadsForViewer/getInteractions, in particular) run under this route's
// function budget. Vercel's default (10s on Hobby) isn't enough for a
// client with a large lead volume — a 3-way-joined, paginated query can run
// past it, killing the request with no error surfaced to the browser.
export const maxDuration = 60

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
    // page.tsx used to eagerly fetch every tab's full dataset — leads,
    // interactions, content pieces, competitors, content analytics, funnel
    // totals, calls — before rendering anything, even for tabs that don't
    // touch most of it. Only cheap counts ship with the initial page now
    // (used for the tab-bar badges); each tab fetches its own full data
    // lazily once it's actually opened: CrmTabLazy (crm-tab.tsx),
    // ContentMetricsGridLazy, ClientCallsListLazy, ClientCompetitorsLazy.
    // Analítica (ClientAnalyticsDashboard), Script (ContentPipelineBoard)
    // and Producto (ProductTab) were already self-fetching.
    const [client, allClients, contentPiecesCount, leadsCount, callsCount, competitorsCount] = await Promise.all([
      getClient(id),
      getClientOptions(),
      getContentPiecesCount(id),
      getLeadsCount(id),
      getCallsCount(id),
      getCompetitorsCount(id),
    ])

    return (
      <Suspense fallback={null}>
        <ClientDetail
          client={client}
          allClients={allClients}
          contentPiecesCount={contentPiecesCount}
          leadsCount={leadsCount}
          callsCount={callsCount}
          competitorsCount={competitorsCount}
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
