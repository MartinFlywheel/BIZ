'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { ClientForm } from './client-form'
import { ContentMetricsGrid } from '@/components/content/content-metrics-grid'
import { type ContentMetric } from '@/components/content/content-funnel-form'

import { ClientCallsList } from './client-calls-list'
import { ClientCompetitors } from './client-competitors'
import { deleteClientAction } from '@/lib/actions/clients'
import { formatCurrency } from '@/lib/utils'
import { ClientAnalyticsDashboard } from './client-analytics-dashboard'
import { ContentPipelineBoard } from './content-pipeline-board'
import { CrmTabLazy } from './crm-tab'
import { ProductTab } from './product-tab'
import { Pencil, Trash2 } from 'lucide-react'
import type { Client, Campaign, ContentPiece, SalesCall, CallFolder, Competitor, CompetitorReel } from '@/lib/types'
import type { ClientFunnelAggregate } from '@/lib/actions/lead-funnel'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'
import type { ClientFunnelTotals } from '@/lib/actions/metrics'
import type { AgendaLeadOption } from '@/lib/actions/agenda-records'

interface AgencyUser {
  id: string
  full_name: string
  email: string
  role: string
  client_id?: string | null
}

interface Props {
  client: Client
  allClients?: Client[]
  campaigns: Campaign[]
  contentPieces: ContentPiece[]
  contentMetrics: ContentMetric[]
  leadsCount: number
  calls: SalesCall[]
  callFolders: CallFolder[]
  agendaLeadOptions: AgendaLeadOption[]
  agencyUsers: AgencyUser[]
  leadFunnel: ClientFunnelAggregate
  competitors: Competitor[]
  competitorReels: Record<string, CompetitorReel[]>
  contentAnalytics: ContentAnalytics
  funnelTotals: ClientFunnelTotals
  readOnly?: boolean
  isAdmin?: boolean
  // Setters only work leads/agendas — every other tab (analytics, content,
  // pipeline, calls, competitors) is agency/strategy info they don't need.
  isSetter?: boolean
  currentUserId?: string
}

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientDetail({ client, allClients = [], campaigns: _campaigns, contentPieces, contentMetrics, leadsCount, calls, callFolders, agendaLeadOptions, agencyUsers, leadFunnel: _leadFunnel, competitors, competitorReels, contentAnalytics, funnelTotals, readOnly = false, isAdmin = false, isSetter = false, currentUserId }: Props) {
  const [editing, setEditing] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  // Setters are locked to CRM regardless of a ?tab= in the URL — filtering
  // the tab bar alone wouldn't stop someone from just typing the query param.
  const initialTab = isSetter ? 'crm' : (searchParams.get('tab') ?? undefined)
  const initialCardId = searchParams.get('card') ?? undefined
  const badge = statusBadge[client.status] || statusBadge.prospect

  async function handleDelete() {
    if (!confirm('¿Eliminar este cliente? Se eliminarán todos sus datos.')) return
    await deleteClientAction(client.id)
    router.push('/clients')
  }

  const tabs = isSetter ? [
    { id: 'crm', label: 'CRM', count: leadsCount },
  ] : [
    { id: 'analytics', label: 'Analítica' },
    { id: 'content_metrics', label: 'Contenido', count: contentPieces.length },
    { id: 'pipeline', label: 'Script' },
    { id: 'crm', label: 'CRM', count: leadsCount },
    { id: 'calls', label: 'Llamadas', count: calls.length },
    { id: 'competencia', label: 'Competencia', count: competitors.length },
    { id: 'producto', label: 'Producto' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-50">{client.name}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">{client.ig_handle}</p>
          {client.industry && <p className="text-xs text-zinc-500">{client.industry}</p>}
          {client.monthly_fee && (
            <p className="mt-1 text-sm text-zinc-300">{formatCurrency(client.monthly_fee)}/mes</p>
          )}
        </div>
        {!readOnly && isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <Tabs tabs={tabs} defaultTab={initialTab}>
        {(activeTab) => (
          <>
            {activeTab === 'analytics' && (
              <ClientAnalyticsDashboard clientId={client.id} />
            )}

            {activeTab === 'content_metrics' && (
              <ContentMetricsGrid
                contentPieces={contentPieces}
                contentMetrics={contentMetrics}
                clientId={client.id}
                contentAnalytics={contentAnalytics}
                funnelTotals={funnelTotals}
              />
            )}

            {activeTab === 'pipeline' && (
              <ContentPipelineBoard clientId={client.id} initialCardId={initialCardId} />
            )}

            {activeTab === 'crm' && (
              <CrmTabLazy
                agencyUsers={agencyUsers}
                allClients={allClients}
                contentPieces={contentPieces}
                clientId={client.id}
                customAvatars={client.custom_avatars}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
              />
            )}

            {activeTab === 'calls' && (
              <ClientCallsList
                clientId={client.id}
                calls={calls}
                callFolders={callFolders}
                agendaLeadOptions={agendaLeadOptions}
              />
            )}

            {activeTab === 'competencia' && (
              <ClientCompetitors
                competitors={competitors}
                competitorReels={competitorReels}
                clientId={client.id}
              />
            )}

            {activeTab === 'producto' && (
              <ProductTab clientId={client.id} />
            )}
          </>
        )}
      </Tabs>

      {!readOnly && editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
    </div>
  )
}
