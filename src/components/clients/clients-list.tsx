'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClientForm } from './client-form'
import { Plus } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Client, ClientStatus } from '@/lib/types'

const statusBadge: Record<ClientStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  prospect: { label: 'Prospecto', variant: 'default' },
  onboarding: { label: 'Onboarding', variant: 'info' },
  active: { label: 'Activo', variant: 'success' },
  paused: { label: 'Pausado', variant: 'warning' },
  churned: { label: 'Churned', variant: 'danger' },
}

export function ClientsList({ clients }: { clients: Client[] }) {
  const [showForm, setShowForm] = useState(false)

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
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {clients.map((client) => {
                const badge = statusBadge[client.status]
                return (
                  <tr key={client.id} className="hover:bg-zinc-800/50 transition-colors">
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <ClientForm onClose={() => setShowForm(false)} />}
    </>
  )
}
