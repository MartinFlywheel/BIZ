'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { CrmTab } from './crm-tab'
import { Pencil, Trash2 } from 'lucide-react'
import type { Client, Campaign, ContentPiece, Interaction, Lead, SalesCall, Competitor, CompetitorReel } from '@/lib/types'
import type { ClientFunnelAggregate } from '@/lib/actions/lead-funnel'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'
import type { ClientFunnelTotals } from '@/lib/actions/metrics'

interface AgencyUser {
  id: string
  full_name: string
  email: string
  role: string
}

interface Props {
  client: Client
  campaigns: Campaign[]
  contentPieces: ContentPiece[]
  contentMetrics: ContentMetric[]
  leads: Lead[]
  calls: SalesCall[]
  agencyUsers: AgencyUser[]
  interactions: Interaction[]
  leadFunnel: ClientFunnelAggregate
  competitors: Competitor[]
  competitorReels: Record<string, CompetitorReel[]>
  contentAnalytics: ContentAnalytics
  funnelTotals: ClientFunnelTotals
  readOnly?: boolean
}

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientDetail({ client, campaigns: _campaigns, contentPieces, contentMetrics, leads, calls, agencyUsers, interactions, leadFunnel: _leadFunnel, competitors, competitorReels, contentAnalytics, funnelTotals, readOnly = false }: Props) {
  const [editing, setEditing] = useState(false)
  const router = useRouter()
  const badge = statusBadge[client.status] || statusBadge.prospect

  async function handleDelete() {
    if (!confirm('¿Eliminar este cliente? Se eliminarán todos sus datos.')) return
    await deleteClientAction(client.id)
    router.push('/clients')
  }

  const tabs = [
    { id: 'analytics', label: 'Analítica' },
    { id: 'content_metrics', label: 'Contenido y Métricas', count: contentPieces.length },
    { id: 'pipeline', label: 'Pipeline Contenido' },
    { id: 'crm', label: 'CRM', count: leads.length },
    { id: 'calls', label: 'Llamadas', count: calls.length },
{ id: 'competencia', label: 'Competencia', count: competitors.length },
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
        {!readOnly && (
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

      <Tabs tabs={tabs}>
        {(activeTab) => (
          <>
            {activeTab === 'analytics' && (
              <ClientAnalyticsDashboard clientId={client.id} />
            )}

            {activeTab === 'content_metrics' && (
              <ContentMetricsGrid
                contentPieces={contentPieces}
                contentMetrics={contentMetrics}
                interactions={interactions}
                clientId={client.id}
                contentAnalytics={contentAnalytics}
                funnelTotals={funnelTotals}
              />
            )}

            {activeTab === 'pipeline' && (
              <ContentPipelineBoard clientId={client.id} />
            )}

            {activeTab === 'crm' && (
              <CrmTab
                leads={leads}
                agencyUsers={agencyUsers}
                contentPieces={contentPieces}
                interactions={interactions}
                clientId={client.id}
                customAvatars={client.custom_avatars}
              />
            )}

            {activeTab === 'calls' && (
              <ClientCallsList
                calls={calls}
                leads={leads}
              />
            )}

{activeTab === 'competencia' && (
              <ClientCompetitors
                competitors={competitors}
                competitorReels={competitorReels}
                clientId={client.id}
              />
            )}
          </>
        )}
      </Tabs>

      {!readOnly && editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
    </div>
  )
}
