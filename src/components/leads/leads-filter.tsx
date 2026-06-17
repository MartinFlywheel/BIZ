'use client'

import { useRouter } from 'next/navigation'
import type { Client } from '@/lib/types'

export function LeadsFilter({ clients, selectedClient }: { clients: Client[]; selectedClient: string }) {
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    router.push(val ? `/leads?client=${val}` : '/leads')
  }

  return (
    <select
      value={selectedClient}
      onChange={handleChange}
      className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
    >
      <option value="">Todos los clientes</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>{c.ig_handle} — {c.name}</option>
      ))}
    </select>
  )
}
