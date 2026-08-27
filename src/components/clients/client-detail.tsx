'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { ClientForm } from './client-form'
import { ContentMetricsGridLazy } from '@/components/content/content-metrics-grid'

import { ClientCallsListLazy } from './client-calls-list'
import { ClientCompetitorsLazy } from './client-competitors'
import { deleteClientAction } from '@/lib/actions/clients'
import { formatCurrency } from '@/lib/utils'
import { ClientAnalyticsDashboard } from './client-analytics-dashboard'
import { ContentPipelineBoard } from './content-pipeline-board'
import { CrmTabLazy } from './crm-tab'
import { ProductTab } from './product-tab'
import { Pencil, Trash2 } from 'lucide-react'
import type { Client } from '@/lib/types'

interface Props {
  client: Client
  allClients?: Client[]
  contentPiecesCount: number
  leadsCount: number
  callsCount: number
  competitorsCount: number
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

export function ClientDetail({ client, allClients = [], contentPiecesCount, leadsCount, callsCount, competitorsCount, readOnly = false, isAdmin = false, isSetter = false, currentUserId }: Props) {
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
    { id: 'content_metrics', label: 'Contenido', count: contentPiecesCount },
    { id: 'pipeline', label: 'Script' },
    { id: 'crm', label: 'CRM', count: leadsCount },
    { id: 'calls', label: 'Llamadas', count: callsCount },
    { id: 'competencia', label: 'Competencia', count: competitorsCount },
    { id: 'producto', label: 'Producto' },
  ]

  // Every tab here lazy-fetches its own data on mount. Tabs used to fully
  // unmount when you switched away (only the active one was ever rendered),
  // so revisiting a tab meant refetching everything from scratch every
  // single click — for CRM specifically (12k+ leads on some clients, a
  // 3-way-joined paginated query) that's expensive enough to feel like a
  // regression. Once a tab has been opened, keep it mounted (hidden via
  // CSS instead of unmounted) so switching back is instant and free.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(
    () => new Set([initialTab || tabs[0]?.id].filter((id): id is string => !!id))
  )

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

      <Tabs
        tabs={tabs}
        defaultTab={initialTab}
        onTabChange={(id) => setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))}
      >
        {(activeTab) => (
          <>
            {visitedTabs.has('analytics') && (
              <div hidden={activeTab !== 'analytics'}>
                <ClientAnalyticsDashboard clientId={client.id} />
              </div>
            )}

            {visitedTabs.has('content_metrics') && (
              <div hidden={activeTab !== 'content_metrics'}>
                <ContentMetricsGridLazy clientId={client.id} />
              </div>
            )}

            {visitedTabs.has('pipeline') && (
              <div hidden={activeTab !== 'pipeline'}>
                <ContentPipelineBoard clientId={client.id} initialCardId={initialCardId} />
              </div>
            )}

            {visitedTabs.has('crm') && (
              <div hidden={activeTab !== 'crm'}>
                <CrmTabLazy
                  allClients={allClients}
                  clientId={client.id}
                  customAvatars={client.custom_avatars}
                  pipelineStages={client.pipeline_stages}
                  isAdmin={isAdmin}
                  currentUserId={currentUserId}
                />
              </div>
            )}

            {visitedTabs.has('calls') && (
              <div hidden={activeTab !== 'calls'}>
                <ClientCallsListLazy clientId={client.id} />
              </div>
            )}

            {visitedTabs.has('competencia') && (
              <div hidden={activeTab !== 'competencia'}>
                <ClientCompetitorsLazy clientId={client.id} />
              </div>
            )}

            {visitedTabs.has('producto') && (
              <div hidden={activeTab !== 'producto'}>
                <ProductTab clientId={client.id} />
              </div>
            )}
          </>
        )}
      </Tabs>

      {!readOnly && editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
    </div>
  )
}
