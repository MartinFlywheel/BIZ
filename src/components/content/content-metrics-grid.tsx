'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ContentFunnelForm, type ContentMetric } from './content-funnel-form'
import { ContentPieceForm } from './content-piece-form'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { BarChart2, CheckCircle2, Plus, Link2, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { ContentPiece } from '@/lib/types'

// ── Webhook Integration Banner ────────────────────────────────────────────────

const WEBHOOK_PATH = '/api/webhooks/manychat'

const PAYLOAD_EXAMPLE = `{
  "ig_username": "usuario_ig",
  "full_name": "Nombre Apellido",
  "subscriber_id": "manychat_subscriber_id",
  "payload_id": "C_21_04"
}`

function WebhookBanner() {
    const [copied, setCopied] = useState(false)
    const [expanded, setExpanded] = useState(false)

    const webhookUrl = typeof window !== 'undefined'
        ? `${window.location.origin}${WEBHOOK_PATH}`
        : WEBHOOK_PATH

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(webhookUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // fallback: select text
        }
    }

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            {/* Header — always visible */}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-xs font-medium text-zinc-400">
                        🔗 Integración ManyChat / n8n
                    </span>
                </div>
                {expanded
                    ? <ChevronUp className="h-3.5 w-3.5 text-zinc-600" />
                    : <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                }
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">
                    {/* Webhook URL */}
                    <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                            URL del Webhook
                        </p>
                        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                            <code className="flex-1 text-xs text-zinc-300 font-mono truncate">
                                {webhookUrl}
                            </code>
                            <button
                                onClick={handleCopy}
                                className="flex-shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                                title="Copiar URL"
                            >
                                {copied
                                    ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    : <Copy className="h-3.5 w-3.5" />
                                }
                            </button>
                        </div>
                    </div>

                    {/* Payload structure */}
                    <div className="space-y-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                            Estructura del Payload (JSON)
                        </p>
                        <pre className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-[11px] font-mono text-zinc-400 overflow-x-auto leading-relaxed">
                            {PAYLOAD_EXAMPLE}
                        </pre>
                        <p className="text-[11px] text-zinc-600 leading-snug">
                            El campo <span className="font-mono text-zinc-500">payload_id</span> debe coincidir con el{' '}
                            <span className="font-mono text-zinc-500">keyword_trigger</span> de la pieza de contenido.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

interface Props {
    contentPieces: ContentPiece[]
    contentMetrics: ContentMetric[]
    clientId: string
}

function FunnelStep({
    label,
    value,
    rate,
    highlight,
}: {
    label: string
    value: number
    rate?: string
    highlight?: boolean
}) {
    return (
        <div className="flex flex-col items-center gap-0.5 min-w-[56px]">
            <span className={`font-mono text-xl font-semibold ${highlight ? 'text-emerald-400' : 'text-zinc-100'}`}>
                {formatNumber(value)}
            </span>
            <span className="text-xs text-zinc-500">{label}</span>
            {rate && (
                <span className="text-[10px] text-zinc-600 font-mono">{rate}</span>
            )}
        </div>
    )
}

function FunnelArrow() {
    return (
        <div className="flex flex-col items-center justify-center text-zinc-700 text-lg select-none px-1">
            →
        </div>
    )
}

function pct(num: number, den: number): string {
    if (!den) return '—'
    return `${((num / den) * 100).toFixed(1)}%`
}

const contentTypeLabel: Record<string, string> = {
    reel: 'Reel',
    story: 'Story',
    post: 'Post',
    live: 'Live',
}

export function ContentMetricsGrid({ contentPieces, contentMetrics, clientId }: Props) {
    const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null)
    const [showNewPieceForm, setShowNewPieceForm] = useState(false)

    // Build a map for quick lookup
    const metricsMap = new Map<string, ContentMetric>()
    for (const m of contentMetrics) {
        metricsMap.set(m.content_id, m)
    }

    // Aggregate funnel totals across all pieces
    const totals = contentMetrics.reduce(
        (acc, m) => ({
            chats: acc.chats + (m.chats_nuevos || 0),
            conversaciones: acc.conversaciones + (m.conversaciones || 0),
            agendas: acc.agendas + (m.agendas || 0),
            shows: acc.shows + (m.shows || 0),
            cierres: acc.cierres + (m.cierres || 0),
            cash: acc.cash + (m.cash_collected || 0),
        }),
        { chats: 0, conversaciones: 0, agendas: 0, shows: 0, cierres: 0, cash: 0 }
    )

    // Sum views from content_pieces
    const totalViews = contentPieces.reduce((sum, cp) => sum + (cp.views || 0), 0)

    const selectedMetric = selectedPiece ? (metricsMap.get(selectedPiece.id) ?? null) : null

    return (
        <div className="space-y-6">
            {/* ── Funnel Banner ── */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-zinc-400" />
                        <h3 className="text-sm font-semibold text-zinc-300">Embudo Agregado del Cliente</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {totals.cash > 0 && (
                            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40 rounded-md px-2 py-0.5">
                                {formatCurrency(totals.cash)} cobrado
                            </span>
                        )}
                        <Button size="sm" onClick={() => setShowNewPieceForm(true)}>
                            <Plus className="h-3.5 w-3.5" />
                            Nueva Pieza
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    <FunnelStep label="Views" value={totalViews} />
                    <FunnelArrow />
                    <FunnelStep
                        label="Chats"
                        value={totals.chats}
                        rate={pct(totals.chats, totalViews)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Convs."
                        value={totals.conversaciones}
                        rate={pct(totals.conversaciones, totals.chats)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Agendas"
                        value={totals.agendas}
                        rate={pct(totals.agendas, totals.conversaciones)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Shows"
                        value={totals.shows}
                        rate={pct(totals.shows, totals.agendas)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Cierres"
                        value={totals.cierres}
                        rate={pct(totals.cierres, totals.shows)}
                        highlight
                    />
                </div>
            </div>

            {/* ── Webhook Integration Banner ── */}
            <WebhookBanner />

            {/* ── Content Gallery Grid ── */}
            {contentPieces.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-12 text-center text-zinc-500 text-sm">
                    Sin piezas de contenido registradas
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {contentPieces.map((cp) => {
                        const metric = metricsMap.get(cp.id)
                        const hasMetrics = !!metric

                        return (
                            <button
                                key={cp.id}
                                onClick={() => setSelectedPiece(cp)}
                                className={`group relative rounded-xl border text-left transition-all hover:border-zinc-600 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${hasMetrics
                                    ? 'border-emerald-900/50 bg-emerald-950/10'
                                    : 'border-zinc-800 bg-zinc-900/40'
                                    }`}
                            >
                                {/* Thumbnail */}
                                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-t-xl bg-zinc-800">
                                    {cp.ig_thumbnail_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={cp.ig_thumbnail_url}
                                            alt={cp.caption || cp.content_type}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                            <span className="text-xs text-zinc-600 font-medium uppercase tracking-wider">
                                                {contentTypeLabel[cp.content_type] || cp.content_type}
                                            </span>
                                        </div>
                                    )}

                                    {/* Has-metrics indicator */}
                                    {hasMetrics && (
                                        <div className="absolute top-2 right-2">
                                            <CheckCircle2 className="h-4 w-4 text-emerald-400 drop-shadow" />
                                        </div>
                                    )}

                                    {/* Add metrics overlay on hover */}
                                    {!hasMetrics && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Plus className="h-6 w-6 text-white" />
                                        </div>
                                    )}
                                </div>

                                {/* Card body */}
                                <div className="p-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between gap-1">
                                        <Badge className="text-[10px] px-1.5 py-0">
                                            {contentTypeLabel[cp.content_type]}
                                        </Badge>
                                        <span className="font-mono text-xs text-zinc-300 font-medium">
                                            {formatNumber(cp.views)}
                                        </span>
                                    </div>

                                    {cp.caption && (
                                        <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                            {cp.caption}
                                        </p>
                                    )}

                                    {hasMetrics && metric && (
                                        <div className="flex items-center gap-1.5 pt-0.5">
                                            <span className="text-[10px] text-emerald-500 font-mono">
                                                {metric.cierres} cierre{metric.cierres !== 1 ? 's' : ''}
                                            </span>
                                            {metric.cash_collected != null && (
                                                <>
                                                    <span className="text-[10px] text-zinc-600">·</span>
                                                    <span className="text-[10px] text-emerald-600 font-mono">
                                                        {formatCurrency(metric.cash_collected)}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}

            {/* ── Modals ── */}
            {selectedPiece && (
                <ContentFunnelForm
                    contentPiece={selectedPiece}
                    existingMetric={selectedMetric}
                    onClose={() => setSelectedPiece(null)}
                />
            )}
            {showNewPieceForm && (
                <ContentPieceForm
                    clientId={clientId}
                    onClose={() => setShowNewPieceForm(false)}
                />
            )}
        </div>
    )
}
