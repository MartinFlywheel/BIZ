'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ClientForm } from './client-form'
import { deleteClientAction } from '@/lib/actions/clients'
import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Client, ClientStatus } from '@/lib/types'

const statusBadge: Record<ClientStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientsList({ clients, isAdmin = false }: { clients: Client[]; isAdmin?: boolean }) {
  const [showForm, setShowForm] = useState(false)
  const [toDelete, setToDelete] = useState<Client | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    setError(null)

    const result = await deleteClientAction(toDelete.id)

    setDeleting(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setToDelete(null)
    router.refresh()
  }

  function closeDeleteModal() {
    if (deleting) return
    setToDelete(null)
    setError(null)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Clientes</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {clients.length} cliente{clients.length !== 1 ? 's' : ''} registrado{clients.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          Nuevo Cliente
        </Button>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-500">No hay clientes todavía. Crea el primero.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Cliente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Instagram
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Industria
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Fee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Creado
                </th>
                {isAdmin && <th className="w-16 px-6 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {clients.map((client) => {
                const badge = statusBadge[client.status]
                return (
                  <tr key={client.id} className="group hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-zinc-100 hover:text-white"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{client.ig_handle}</td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{client.industry || '—'}</td>
                    <td className="px-6 py-4">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      {client.monthly_fee ? formatCurrency(client.monthly_fee) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500">{formatDate(client.created_at)}</td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setError(null)
                            setToDelete(client)
                          }}
                          aria-label={`Eliminar ${client.name}`}
                          title={`Eliminar ${client.name}`}
                          className="rounded-lg p-2 text-zinc-500 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <ClientForm onClose={() => setShowForm(false)} />}

      {toDelete && (
        <Modal onClose={closeDeleteModal} size="sm">
          <h2 className="text-lg font-semibold text-zinc-50">Eliminar cliente</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Se eliminará <span className="font-medium text-zinc-200">{toDelete.name}</span> junto con
            todos sus datos asociados: leads, conversaciones, contenido, métricas, llamadas, agendas,
            competencia y tareas. Esta acción no se puede deshacer.
          </p>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={closeDeleteModal} disabled={deleting} className="flex-1">
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting} className="flex-1">
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
