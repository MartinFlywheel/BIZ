'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs } from '@/components/ui/tabs'
import { ClientForm } from './client-form'
import { CampaignForm } from '@/components/campaigns/campaign-form'
import { ContentMetricsGrid } from '@/components/content/content-metrics-grid'
import { type ContentMetric } from '@/components/content/content-funnel-form'
import { ClientLeadsBoard } from './client-leads-board'
import { ClientCallsList } from './client-calls-list'
import { ClientCompetitors } from './client-competitors'
import { deleteClientAction } from '@/lib/actions/clients'
import { deleteCampaignAction } from '@/lib/actions/campaigns'
import { formatDate, formatCurrency } from '@/lib/utils'
import { Pencil, Trash2, Plus } from 'lucide-react'
import type { Client, Campaign, ContentPiece, Interaction, Lead, SalesCall, Competitor, CompetitorReel } from '@/lib/types'
import type { ClientFunnelAggregate } from '@/lib/actions/lead-funnel'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'

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
}

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientDetail({ client, campaigns, contentPieces, contentMetrics, leads, calls, agencyUsers, interactions, leadFunnel, competitors, competitorReels, contentAnalytics }: Props) {
  const [editing, setEditing] = useState(false)
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const router = useRouter()
  const badge = statusBadge[client.status] || statusBadge.prospect

  async function handleDelete() {
    if (!confirm('¿Eliminar este cliente? Se eliminarán todos sus datos.')) return
    await deleteClientAction(client.id)
    router.push('/clients')
  }

  const tabs = [
    { id: 'campaigns', label: 'Campañas', count: campaigns.length },
    { id: 'content_metrics', label: 'Contenido y Métricas', count: contentPieces.length },
    { id: 'crm_setters', label: 'CRM Setters', count: leads.length },
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
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs}>
        {(activeTab) => (
          <>
            {activeTab === 'campaigns' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowCampaignForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nueva Campaña
                  </Button>
                </div>
                {campaigns.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">Sin campañas</div></Card>
                ) : (
                  <div className="space-y-3">
                    {campaigns.map((c) => (
                      <Card key={c.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-zinc-100">{c.name}</p>
                          <p className="text-xs text-zinc-500">
                            {formatDate(c.start_date)} {c.end_date ? `— ${formatDate(c.end_date)}` : ''}
                          </p>
                          {c.goal && <p className="text-xs text-zinc-400 mt-1">{c.goal}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={c.status === 'active' ? 'success' : c.status === 'completed' ? 'default' : 'warning'}>
                            {c.status}
                          </Badge>
                          <button
                            onClick={async () => {
                              if (confirm('¿Eliminar esta campaña?')) {
                                await deleteCampaignAction(c.id, client.id)
                                router.refresh()
                              }
                            }}
                            className="text-zinc-500 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'content_metrics' && (
              <ContentMetricsGrid
                contentPieces={contentPieces}
                contentMetrics={contentMetrics}
                clientId={client.id}
                contentAnalytics={contentAnalytics}
              />
            )}

            {activeTab === 'crm_setters' && (
              <ClientLeadsBoard
                leads={leads}
                agencyUsers={agencyUsers}
                contentPieces={contentPieces}
                clientId={client.id}
                leadFunnel={leadFunnel}
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

      {editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
      {showCampaignForm && (
        <CampaignForm
          clientId={client.id}
          onClose={() => { setShowCampaignForm(false); router.refresh() }}
        />
      )}
    </div>
  )
}
