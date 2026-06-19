'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { Tabs } from '@/components/ui/tabs'
import { ClientForm } from './client-form'
import { CampaignForm } from '@/components/campaigns/campaign-form'
import { ContentForm } from '@/components/content/content-form'
import { InteractionForm } from '@/components/interactions/interaction-form'
import { TeamAssignmentForm } from '@/components/team/team-assignment-form'
import { ClientMetricsForm } from './client-metrics-form'
import { CsvImport } from '@/components/csv/csv-import'

import { deleteClientAction } from '@/lib/actions/clients'
import { deleteCampaignAction } from '@/lib/actions/campaigns'
import { formatDate, formatCurrency } from '@/lib/utils'
import { Pencil, Trash2, Plus } from 'lucide-react'
import type { Client, Campaign, ContentPiece, Interaction, TeamAssignment, ClientMetrics } from '@/lib/types'

interface Props {
  client: Client
  campaigns: Campaign[]
  contentPieces: ContentPiece[]
  interactions: Interaction[]
  teamAssignments: (TeamAssignment & { users: { full_name: string; email: string; role: string } })[]
  agencyUsers: { id: string; full_name: string; email: string; role: string }[]
  metrics: ClientMetrics[]
}


const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

const responsibilityLabels: Record<string, string> = {
  content: 'Contenido',
  setting: 'Setting',
  closing: 'Closing',
  strategy: 'Estrategia',
}

export function ClientDetail({ client, campaigns, contentPieces, interactions, teamAssignments, agencyUsers, metrics }: Props) {
  const [editing, setEditing] = useState(false)
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [showContentForm, setShowContentForm] = useState(false)
  const [showInteractionForm, setShowInteractionForm] = useState(false)
  const [showTeamForm, setShowTeamForm] = useState(false)
  const [showMetricsForm, setShowMetricsForm] = useState(false)
  const router = useRouter()
  const badge = statusBadge[client.status] || statusBadge.prospect


  async function handleDelete() {
    if (!confirm('¿Eliminar este cliente? Se eliminarán todos sus datos.')) return
    await deleteClientAction(client.id)
    router.push('/clients')
  }

  const tabs = [
    { id: 'campaigns', label: 'Campañas', count: campaigns.length },
    { id: 'content', label: 'Contenido', count: contentPieces.length },
    { id: 'interactions', label: 'Interacciones', count: interactions.length },
    { id: 'metrics', label: 'Métricas', count: metrics.length },
    { id: 'team', label: 'Equipo', count: teamAssignments.length },
    { id: 'import', label: 'Importar CSV' },
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

            {activeTab === 'content' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowContentForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Agregar Contenido
                  </Button>
                </div>
                {contentPieces.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">Sin contenido</div></Card>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Tipo</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Caption</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Views</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Likes</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Shares</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Saves</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Keyword</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {contentPieces.map((cp) => (
                          <tr key={cp.id} className="hover:bg-zinc-800/50">
                            <td className="px-4 py-3">
                              <Badge>{cp.content_type}</Badge>
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-300 max-w-[200px] truncate">
                              {cp.caption || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-200 text-right font-medium">{cp.views.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right">{cp.likes.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right">{cp.shares.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right">{cp.saves.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400">{cp.keyword_trigger || '—'}</td>
                            <td className="px-4 py-3 text-sm text-zinc-500">
                              {cp.published_at ? formatDate(cp.published_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'interactions' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowInteractionForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Nueva Interacción
                  </Button>
                </div>
                {interactions.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">Sin interacciones</div></Card>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Prospecto</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Clasificación</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Keyword</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Fuente</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Fecha</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Lead</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {interactions.map((i) => (
                          <tr key={i.id} className="hover:bg-zinc-800/50">
                            <td className="px-4 py-3 text-sm text-zinc-200">
                              {i.ig_username || i.prospect_name || '—'}
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={
                                i.classification === 'conversacion_real' ? 'success' :
                                  i.classification === 'disqualified' ? 'danger' : 'default'
                              }>
                                {i.classification === 'chat_abierto' ? 'Chat Abierto' :
                                  i.classification === 'conversacion_real' ? 'Conv. Real' : 'Descalificado'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-400">{i.keyword_used || '—'}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400">{i.source}</td>
                            <td className="px-4 py-3 text-sm text-zinc-500">{formatDate(i.bot_triggered_at)}</td>
                            <td className="px-4 py-3">
                              {i.promoted_to_lead ? (
                                <Badge variant="info">Promovido</Badge>
                              ) : i.classification === 'conversacion_real' ? (
                                <span className="text-xs text-zinc-500">Pendiente</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'team' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowTeamForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Asignar Miembro
                  </Button>
                </div>
                {teamAssignments.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">Sin equipo asignado</div></Card>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {teamAssignments.map((ta) => (
                      <Card key={ta.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-zinc-100">{ta.users.full_name}</p>
                          <p className="text-xs text-zinc-500">{ta.users.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="info">
                            {responsibilityLabels[ta.responsibility] || ta.responsibility}
                          </Badge>
                          {ta.is_primary && <Badge variant="success">Principal</Badge>}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'metrics' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-zinc-400">
                    Snapshots semanales del funnel (alimentan el Dashboard).
                  </p>
                  <Button size="sm" onClick={() => setShowMetricsForm(true)}>
                    <Plus className="h-3.5 w-3.5" /> Cargar Semana
                  </Button>
                </div>
                {metrics.length === 0 ? (
                  <Card><div className="text-center text-zinc-500 py-8">Sin métricas cargadas</div></Card>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Período</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Views R</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Chats</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Conv.</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Agendas</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Shows</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Cierres</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Cash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {metrics.map((m) => (
                          <tr key={m.id} className="hover:bg-zinc-800/50">
                            <td className="px-4 py-3 text-sm text-zinc-200">
                              {formatDate(m.period_start)} — {formatDate(m.period_end)}
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.views_reels.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.chats_abiertos.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.conversaciones.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.agendas.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.shows.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-zinc-200 text-right font-mono font-medium">{m.cierres.toLocaleString()}</td>
                            <td className="px-4 py-3 text-sm text-emerald-300 text-right font-mono">{formatCurrency(m.cash_collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'import' && (
              <CsvImport clientId={client.id} />
            )}
          </>
        )}
      </Tabs>


      {editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
      {showCampaignForm && <CampaignForm clientId={client.id} onClose={() => { setShowCampaignForm(false); router.refresh() }} />}
      {showContentForm && <ContentForm clientId={client.id} campaigns={campaigns} onClose={() => { setShowContentForm(false); router.refresh() }} />}
      {showInteractionForm && <InteractionForm clientId={client.id} campaigns={campaigns} contentPieces={contentPieces} onClose={() => { setShowInteractionForm(false); router.refresh() }} />}
      {showTeamForm && <TeamAssignmentForm clientId={client.id} users={agencyUsers} onClose={() => { setShowTeamForm(false); router.refresh() }} />}
      {showMetricsForm && <ClientMetricsForm clientId={client.id} onClose={() => { setShowMetricsForm(false); router.refresh() }} />}
    </div>

  )
}
