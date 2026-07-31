'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import type { ContentPiece, Interaction } from '@/lib/types'

interface Props {
  contentPieces: ContentPiece[]
  interactions: Interaction[]
}

interface Row {
  content_id: string
  caption: string | null
  keyword_trigger: string | null
  content_type: string
  chats: number
  conversaciones: number
  conversion_rate: number
  // True when every "conversacion_real" row for this piece was inserted in a
  // single call (bot_triggered_at === prospect_responded_at — the same `now`
  // used for both fields in upsertInteraction's direct-insert branch) and
  // none are still sitting at chat_abierto. That means no row has ever shown
  // real evidence of the chat-abierto step firing for this piece — a strong
  // signal that ManyChat node isn't wired here, which inflates the piece's
  // conversion rate to a fake ~100%.
  missing_chat_node: boolean
}

const contentTypeLabel: Record<string, string> = {
  reel: 'Reel',
  story: 'Story',
  post: 'Post',
  live: 'Live',
}

type TypeFilter = 'all' | 'reel' | 'story'

const TYPE_FILTER_OPTIONS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'reel', label: 'Reels' },
  { key: 'story', label: 'Historias' },
]

function rateColor(rate: number): string {
  if (rate >= 70) return 'text-emerald-400'
  if (rate >= 30) return 'text-amber-400'
  return 'text-red-400'
}

export function ContentConversationTable({ contentPieces, interactions }: Props) {
  const [expanded, setExpanded] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const rows = useMemo<Row[]>(() => {
    const pieceMap = new Map(contentPieces.map((p) => [p.id, p]))
    const statsMap = new Map<string, { chats: number; conversaciones: number; chatAbiertoEvidence: number }>()

    for (const i of interactions) {
      if (!i.content_id) continue
      const s = statsMap.get(i.content_id) ?? { chats: 0, conversaciones: 0, chatAbiertoEvidence: 0 }
      s.chats += 1
      if (i.classification === 'chat_abierto') {
        s.chatAbiertoEvidence += 1
      } else if (i.classification === 'conversacion_real') {
        s.conversaciones += 1
        if (i.prospect_responded_at !== i.bot_triggered_at) s.chatAbiertoEvidence += 1
      }
      statsMap.set(i.content_id, s)
    }

    return Array.from(statsMap.entries())
      .map(([content_id, s]) => {
        const p = pieceMap.get(content_id)
        return {
          content_id,
          caption: p?.caption ?? null,
          keyword_trigger: p?.keyword_trigger ?? null,
          content_type: p?.content_type ?? 'reel',
          chats: s.chats,
          conversaciones: s.conversaciones,
          conversion_rate: s.chats > 0 ? Math.round((s.conversaciones / s.chats) * 1000) / 10 : 0,
          missing_chat_node: s.conversaciones > 0 && s.chatAbiertoEvidence === 0,
        }
      })
      .sort((a, b) => b.chats - a.chats)
  }, [contentPieces, interactions])

  const filteredRows = typeFilter === 'all' ? rows : rows.filter((r) => r.content_type === typeFilter)
  const flaggedCount = filteredRows.filter((r) => r.missing_chat_node).length

  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-300">Chats → Conversaciones por Pieza</h3>
          {flaggedCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-950/30 border border-amber-900/40 rounded-full px-2 py-0.5">
              <AlertTriangle className="h-3 w-3" />
              {flaggedCount} sin nodo chat-abierto
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-zinc-600" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800">
          <div className="flex items-center gap-1.5 px-5 pt-3">
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setTypeFilter(opt.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  typeFilter === opt.key
                    ? 'bg-white/[0.08] text-zinc-100 border border-white/[0.12]'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Pieza</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tipo</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Chats</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Convs.</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tasa</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-zinc-600">
                    Sin piezas de este tipo con chats registrados
                  </td>
                </tr>
              ) : filteredRows.map((r) => (
                <tr key={r.content_id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2 text-xs text-zinc-200 max-w-[220px] truncate" title={r.caption ?? r.keyword_trigger ?? ''}>
                    {r.keyword_trigger || r.caption || 'Sin título'}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{contentTypeLabel[r.content_type] || r.content_type}</td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-zinc-300">{r.chats}</td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-zinc-300">{r.conversaciones}</td>
                  <td className={`px-3 py-2 text-xs font-mono font-semibold text-right ${rateColor(r.conversion_rate)}`}>
                    {r.conversion_rate}%
                  </td>
                  <td className="px-4 py-2">
                    {r.missing_chat_node && (
                      <span
                        className="flex items-center gap-1 text-[10px] text-amber-500"
                        title="Todas las conversaciones de esta pieza se registraron en un solo paso — probablemente falta el nodo /chat-abierto en el flujo de ManyChat."
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Sin nodo chat-abierto
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
