'use client'

import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { ExternalLink, Clock, Mic } from 'lucide-react'
import type { SalesCall, Lead } from '@/lib/types'

interface Props {
    calls: SalesCall[]
    leads: Lead[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
    if (!seconds) return '—'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

const OUTCOME_BADGE: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
    completed: { label: 'Completada', variant: 'success' },
    no_show: { label: 'No Show', variant: 'danger' },
    rescheduled: { label: 'Reagendada', variant: 'warning' },
    cancelled: { label: 'Cancelada', variant: 'default' },
}

const SENTIMENT_DOT: Record<string, string> = {
    positive: 'bg-emerald-400',
    neutral: 'bg-zinc-400',
    negative: 'bg-red-400',
}

const SENTIMENT_LABEL: Record<string, string> = {
    positive: 'Positivo',
    neutral: 'Neutral',
    negative: 'Negativo',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClientCallsList({ calls, leads }: Props) {
    // Build lead lookup map
    const leadsMap = new Map<string, Lead>()
    for (const l of leads) leadsMap.set(l.id, l)

    if (calls.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <Mic className="h-8 w-8 text-zinc-700 mb-3" />
                <p className="text-sm text-zinc-500">Sin llamadas registradas</p>
                <p className="text-xs text-zinc-600 mt-1">Las llamadas aparecerán aquí cuando se registren</p>
            </div>
        )
    }

    // Sort by scheduled_at desc
    const sorted = [...calls].sort((a, b) => {
        const da = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0
        const db = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0
        return db - da
    })

    return (
        <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_140px_100px_80px_80px_40px] gap-4 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                <span>Lead</span>
                <span>Fecha</span>
                <span>Estado</span>
                <span>Duración</span>
                <span>Sentimiento</span>
                <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-zinc-900">
                {sorted.map((call) => {
                    const lead = leadsMap.get(call.lead_id)
                    const leadName = lead?.full_name || lead?.ig_username || 'Lead desconocido'
                    const outcomeCfg = call.outcome ? OUTCOME_BADGE[call.outcome] : null
                    const sentimentDot = call.sentiment ? SENTIMENT_DOT[call.sentiment] : null
                    const sentimentLabel = call.sentiment ? SENTIMENT_LABEL[call.sentiment] : null

                    return (
                        <div
                            key={call.id}
                            className="grid grid-cols-[1fr_140px_100px_80px_80px_40px] gap-4 items-center px-4 py-3.5 rounded-lg hover:bg-zinc-900/60 transition-colors group"
                        >
                            {/* Lead name */}
                            <div>
                                <p className="text-sm font-medium text-zinc-100 truncate">{leadName}</p>
                                {lead?.ig_username && lead?.full_name && (
                                    <p className="text-xs text-zinc-600 truncate">@{lead.ig_username}</p>
                                )}
                            </div>

                            {/* Date */}
                            <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                                <span>{call.scheduled_at ? formatDate(call.scheduled_at) : '—'}</span>
                            </div>

                            {/* Outcome */}
                            <div>
                                {outcomeCfg ? (
                                    <Badge variant={outcomeCfg.variant}>{outcomeCfg.label}</Badge>
                                ) : (
                                    <span className="text-sm text-zinc-600">—</span>
                                )}
                            </div>

                            {/* Duration */}
                            <div className="flex items-center gap-1 text-sm text-zinc-400">
                                {call.duration_seconds ? (
                                    <>
                                        <Clock className="h-3 w-3 text-zinc-600 flex-shrink-0" />
                                        <span className="font-mono">{formatDuration(call.duration_seconds)}</span>
                                    </>
                                ) : (
                                    <span className="text-zinc-600">—</span>
                                )}
                            </div>

                            {/* Sentiment */}
                            <div className="flex items-center gap-1.5">
                                {sentimentDot && sentimentLabel ? (
                                    <>
                                        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${sentimentDot}`} />
                                        <span className="text-xs text-zinc-400">{sentimentLabel}</span>
                                    </>
                                ) : (
                                    <span className="text-zinc-600 text-sm">—</span>
                                )}
                            </div>

                            {/* Fathom link */}
                            <div className="flex justify-end">
                                {call.fathom_call_url ? (
                                    <a
                                        href={call.fathom_call_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Ver grabación en Fathom"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                ) : null}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
