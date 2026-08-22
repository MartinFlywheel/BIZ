import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getClient } from '@/lib/actions/clients'
import { getContentPiecesCount } from '@/lib/actions/content'
import { getLeadsCount } from '@/lib/actions/leads'
import { getCallsCount } from '@/lib/actions/calls'
import { getCompetitorsCount } from '@/lib/actions/competitors'
import { ClientDetail } from '@/components/clients/client-detail'

// Same reasoning as clients/[id]/page.tsx: Server Actions invoked from
// this page's client components share its function budget, and the
// default (10s on Hobby) isn't enough for a client with a large lead volume.
export const maxDuration = 60

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

  // Same fix as clients/[id]/page.tsx: this used to eagerly fetch every
  // tab's full dataset (content pieces, calls, competitors, analytics...)
  // before rendering anything. Only cheap counts ship now; each tab fetches
  // its own data lazily once it's actually opened.
  const [client, contentPiecesCount, leadsCount, callsCount, competitorsCount] = await Promise.all([
    getClient(clientId),
    getContentPiecesCount(clientId),
    getLeadsCount(clientId),
    getCallsCount(clientId),
    getCompetitorsCount(clientId),
  ])

  return (
    <Suspense fallback={null}>
      <ClientDetail
        client={client}
        contentPiecesCount={contentPiecesCount}
        leadsCount={leadsCount}
        callsCount={callsCount}
        competitorsCount={competitorsCount}
        readOnly
      />
    </Suspense>
  )
}
