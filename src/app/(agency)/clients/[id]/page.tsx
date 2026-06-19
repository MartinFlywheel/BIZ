import { getClient } from '@/lib/actions/clients'
import { getCampaigns } from '@/lib/actions/campaigns'
import { getContentPieces } from '@/lib/actions/content'
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

  const data = await Promise.all([
    getClient(id),
    getCampaigns(id),
    getContentPieces(id),
    getClientMetrics(id, 'weekly'),
  ]).catch(() => null)

  if (!data) notFound()

  const [client, campaigns, contentPieces, metrics] = data

  return (
    <ClientDetail
      client={client}
      campaigns={campaigns}
      contentPieces={contentPieces}
      metrics={(metrics ?? []) as ClientMetrics[]}
    />
  )
}
