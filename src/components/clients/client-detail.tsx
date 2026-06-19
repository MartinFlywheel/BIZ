'use client'

import { Fragment, useState } from 'react'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { Tabs } from '@/components/ui/tabs'
import { ClientForm } from './client-form'
import { CampaignForm } from '@/components/campaigns/campaign-form'
import { ContentForm } from '@/components/content/content-form'
import { ClientMetricsForm } from './client-metrics-form'
import { ClientActions } from './client-actions'

import { deleteClientAction } from '@/lib/actions/clients'
import { deleteCampaignAction } from '@/lib/actions/campaigns'
import { formatDate, formatCurrency } from '@/lib/utils'
import { Pencil, Trash2, Plus, ChevronRight, NotebookPen } from 'lucide-react'
import type { Client, Campaign, ContentPiece, ClientMetrics } from '@/lib/types'

interface Props {
  client: Client
  campaigns: Campaign[]
  contentPieces: ContentPiece[]
  metrics: ClientMetrics[]
}


const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientDetail({ client, campaigns, contentPieces, metrics }: Props) {
  const [editing, setEditing] = useState(false)
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [showContentForm, setShowContentForm] = useState(false)
  const [showMetricsForm, setShowMetricsForm] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
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
    { id: 'metrics', label: 'Métricas', count: metrics.length },
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

      {/* Hub de Acciones Esenciales */}
      <ClientActions client={client} onLoadWeek={() => setShowMetricsForm(true)} />

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

            {activeTab === 'metrics' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-zinc-400">
                    Snapshots semanales del funnel (alimentan el Dashboard). Clic en una fila para ver las notas estratégicas.
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
                          <th className="w-8 px-4 py-3"></th>
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
                        {metrics.map((m) => {
                          const isExpanded = expandedRow === m.id
                          const hasNotes = Boolean(m.notes && m.notes.trim())
                          return (
                            <Fragment key={m.id}>
                              <tr
                                onClick={() => setExpandedRow(isExpanded ? null : m.id)}

                                className="cursor-pointer hover:bg-zinc-800/50"
                              >
                                <td className="px-4 py-3 text-zinc-500">
                                  <ChevronRight
                                    className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90 text-zinc-300' : ''} ${hasNotes ? '' : 'opacity-30'}`}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm text-zinc-200">
                                  <div className="flex items-center gap-2">
                                    {formatDate(m.period_start)} — {formatDate(m.period_end)}
                                    {hasNotes && <NotebookPen className="h-3.5 w-3.5 text-amber-400/70" />}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.views_reels.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.chats_abiertos.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.conversaciones.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.agendas.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400 text-right font-mono">{m.shows.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-200 text-right font-mono font-medium">{m.cierres.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-emerald-300 text-right font-mono">{formatCurrency(m.cash_collected)}</td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${m.id}-notes`} className="bg-zinc-950/40">
                                  <td></td>
                                  <td colSpan={8} className="px-4 py-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <NotebookPen className="h-3.5 w-3.5 text-amber-400/70" />
                                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                                        Notas Estratégicas / Ángulos de Contenido
                                      </span>
                                    </div>
                                    {hasNotes ? (
                                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                                        {m.notes}
                                      </p>
                                    ) : (
                                      <p className="text-sm italic text-zinc-600">
                                        Sin notas para este período. Agrégalas al cargar la semana.
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )

                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Tabs>


      {editing && <ClientForm client={client} onClose={() => setEditing(false)} />}
      {showCampaignForm && <CampaignForm clientId={client.id} onClose={() => { setShowCampaignForm(false); router.refresh() }} />}
      {showContentForm && <ContentForm clientId={client.id} campaigns={campaigns} onClose={() => { setShowContentForm(false); router.refresh() }} />}
      {showMetricsForm && <ClientMetricsForm clientId={client.id} onClose={() => { setShowMetricsForm(false); router.refresh() }} />}
    </div>

  )
}
