'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ContentNotesPanel } from './content-notes-panel'
import { formatNumber, formatDate } from '@/lib/utils'
import { MessageSquare, Plus } from 'lucide-react'
import type { ContentPiece, Client } from '@/lib/types'

interface ContentWithRelations extends ContentPiece {
  clients: { name: string; ig_handle: string } | null
  campaigns: { name: string } | null
}

interface Props {
  contentPieces: ContentWithRelations[]
  clients: Client[]
}

export function ContentList({ contentPieces, clients }: Props) {
  const [selectedContent, setSelectedContent] = useState<ContentWithRelations | null>(null)
  const [filterClient, setFilterClient] = useState<string>('')

  const filtered = filterClient
    ? contentPieces.filter((cp) => cp.client_id === filterClient)
    : contentPieces

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Contenido</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {filtered.length} pieza{filtered.length !== 1 ? 's' : ''} de contenido
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
          >
            <option value="">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.ig_handle}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-500">Sin contenido. Agrégalo desde la ficha del cliente.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Caption</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Views</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Likes</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">Saves</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Keyword</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Fecha</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-zinc-400">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((cp) => (
                <tr key={cp.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-3 text-sm text-zinc-300">{cp.clients?.ig_handle || '—'}</td>
                  <td className="px-4 py-3"><Badge>{cp.content_type}</Badge></td>
                  <td className="px-4 py-3 text-sm text-zinc-300 max-w-[180px] truncate">{cp.caption || '—'}</td>
                  <td className="px-4 py-3 text-sm text-zinc-200 text-right font-medium">{formatNumber(cp.views)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400 text-right">{formatNumber(cp.likes)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400 text-right">{formatNumber(cp.saves)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{cp.keyword_trigger || '—'}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{cp.published_at ? formatDate(cp.published_at) : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setSelectedContent(cp)}
                      className="text-zinc-500 hover:text-zinc-200 transition-colors"
                      title="Ver notas"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedContent && (
        <ContentNotesPanel
          contentId={selectedContent.id}
          contentCaption={selectedContent.caption}
          onClose={() => setSelectedContent(null)}
        />
      )}
    </>
  )
}
