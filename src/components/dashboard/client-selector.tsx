'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { Client } from '@/lib/types'

export function ClientSelector({ clients, selectedId }: { clients: Client[]; selectedId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value) {
      params.set('client', e.target.value)
    } else {
      params.delete('client')
    }
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <select
      value={selectedId || ''}
      onChange={handleChange}
      className="h-9 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 text-sm text-zinc-100 transition-all duration-200 hover:border-white/[0.1] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff453a]/40 [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
    >
      <option value="">Todos los clientes</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.ig_handle} — {c.name}
        </option>
      ))}
    </select>
  )
}
