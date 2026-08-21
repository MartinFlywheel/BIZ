'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, AtSign } from 'lucide-react'
import { getLeadMessages, sendLeadMessage } from '@/lib/actions/lead-chat'
import type { IncomingMessage } from '@/lib/types'

interface Props {
  leadId: string
  clientId: string
  fullName: string | null
  igUsername: string | null
}

const POLL_MS = 6000

function initialsOf(name: string | null, handle: string | null): string {
  const source = name || handle || '?'
  return source.trim().slice(0, 1).toUpperCase()
}

export function LeadChatView({ leadId, clientId, fullName, igUsername }: Props) {
  const [messages, setMessages] = useState<IncomingMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await getLeadMessages(leadId)
      setMessages(data)
    } catch {
      // Transient poll failure — keep showing whatever we already have.
    }
  }, [leadId])

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    const result = await sendLeadMessage(leadId, text)
    setSending(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setDraft('')
    load()
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <Link
          href={`/clients/${clientId}?tab=crm`}
          className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-sm font-semibold text-white">
          {initialsOf(fullName, igUsername)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{fullName || igUsername || 'Lead'}</p>
          {igUsername && (
            <p className="flex items-center gap-1 truncate text-xs text-zinc-500">
              <AtSign className="h-3 w-3" />{igUsername}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages === null && (
          <p className="py-16 text-center text-sm text-zinc-500 animate-pulse">Cargando conversación...</p>
        )}
        {messages?.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">Todavía no hay mensajes con esta persona.</p>
        )}
        {messages?.map((msg) => {
          const isOutbound = msg.direction === 'outbound'
          return (
            <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                isOutbound
                  ? 'rounded-tr-sm bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white'
                  : 'rounded-tl-sm bg-zinc-800 text-zinc-100'
              }`}>
                {msg.media_url && (
                  <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="mb-1 block underline">
                    Ver adjunto
                  </a>
                )}
                {msg.message_text && <p className="whitespace-pre-wrap">{msg.message_text}</p>}
                <span className={`mt-1 block text-[10px] ${isOutbound ? 'text-white/60' : 'text-zinc-500'}`}>
                  {new Date(msg.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {isOutbound && !msg.sent_by && ' · bot'}
                </span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p className="pb-2 text-xs text-rose-400">{error}</p>}

      <div className="flex items-center gap-2 border-t border-zinc-800 pt-4">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
          placeholder="Escribí un mensaje..."
          disabled={sending}
          className="flex-1 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
