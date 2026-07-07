'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ContentFunnelForm, type ContentMetric } from './content-funnel-form'
import { ContentPieceForm } from './content-piece-form'
import { ContentAnalyticsSidebar } from './content-analytics-sidebar'
import { deleteContentAction } from '@/lib/actions/content'
import { quickAddLatestReels } from '@/lib/actions/instagram'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { BarChart2, CheckCircle2, Plus, Trash2, Link2, Copy, Check, ChevronDown, ChevronUp, RefreshCw, Heart, MessageCircle, Share2, Bookmark, ExternalLink, Play, ArrowUpDown } from 'lucide-react'
import type { ContentPiece } from '@/lib/types'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'

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

    const baseUrl = typeof window !== 'undefined'
        ? `${window.location.origin}${WEBHOOK_PATH}`
        : WEBHOOK_PATH
    const webhookUrl = `${baseUrl}/{keyword_trigger}`

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
                        <p className="text-[11px] text-zinc-600 leading-snug">
                            Reemplazá <span className="font-mono text-zinc-500">{'{keyword_trigger}'}</span> con el ID de la pieza (ej: C_21_04, R_19_04). Cada pieza tiene su propia URL.
                        </p>
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
    contentAnalytics: ContentAnalytics
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

type SortKey = 'recent' | 'views' | 'revenue' | 'comments'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'recent', label: 'Recientes' },
    { key: 'views', label: 'Vistas' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'comments', label: 'Comentarios' },
]

export function ContentMetricsGrid({ contentPieces, contentMetrics, clientId, contentAnalytics }: Props) {
    const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null)
    const [showNewPieceForm, setShowNewPieceForm] = useState(false)
    const [deleting, setDeleting] = useState<string | null>(null)
    const [quickAdding, setQuickAdding] = useState(false)
    const [quickAddToast, setQuickAddToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [sortBy, setSortBy] = useState<SortKey>('recent')
    const router = useRouter()

    async function handleQuickAdd() {
        setQuickAdding(true)
        setQuickAddToast(null)
        try {
            const result = await quickAddLatestReels(clientId, 10)
            if (result.status === 'error') {
                setQuickAddToast({ type: 'error', message: result.message })
            } else {
                const msg = result.added === 0
                    ? `Sin nuevos reels (${result.skipped} ya existían)`
                    : `${result.added} reel${result.added !== 1 ? 's' : ''} agregado${result.added !== 1 ? 's' : ''}${result.skipped > 0 ? `, ${result.skipped} ya existían` : ''}`
                setQuickAddToast({ type: 'success', message: msg })
                if (result.added > 0) router.refresh()
            }
        } catch (err) {
            setQuickAddToast({ type: 'error', message: err instanceof Error ? err.message : 'Error inesperado' })
        } finally {
            setQuickAdding(false)
            setTimeout(() => setQuickAddToast(null), 5000)
        }
    }

    async function handleDelete(e: React.MouseEvent, piece: ContentPiece) {
        e.stopPropagation()
        if (!confirm(`¿Eliminar "${piece.caption || piece.keyword_trigger || 'esta pieza'}"?\nSe borrarán también sus métricas asociadas.`)) return
        setDeleting(piece.id)
        try {
            await deleteContentAction(piece.id, clientId)
            router.refresh()
        } catch {
            alert('Error al eliminar')
        }
        setDeleting(null)
    }

    // Build a map for quick lookup
    const metricsMap = new Map<string, ContentMetric>()
    for (const m of contentMetrics) {
        metricsMap.set(m.content_id, m)
    }

    // Sort pieces client-side
    const sortedPieces = [...contentPieces].sort((a, b) => {
        if (sortBy === 'views') return (b.views || 0) - (a.views || 0)
        if (sortBy === 'comments') return (b.comments || 0) - (a.comments || 0)
        if (sortBy === 'revenue') {
            const aRev = metricsMap.get(a.id)?.cash_collected || 0
            const bRev = metricsMap.get(b.id)?.cash_collected || 0
            return bRev - aRev
        }
        // 'recent' — server already sorted by published_at desc, preserve order
        return 0
    })

    // Aggregate funnel totals across all pieces
    const totals = contentMetrics.reduce(
        (acc, m) => ({
            chats: acc.chats + (m.chats_nuevos || 0),
            conversaciones: acc.conversaciones + (m.conversaciones_nuevas || 0),
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
        <div className="space-y-4">
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
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleQuickAdd}
                            disabled={quickAdding}
                            title="Importar los últimos 10 reels desde Instagram"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${quickAdding ? 'animate-spin' : ''}`} />
                            {quickAdding ? 'Importando...' : 'Quick Add Reels'}
                        </Button>
                        <Button size="sm" onClick={() => setShowNewPieceForm(true)}>
                            <Plus className="h-3.5 w-3.5" />
                            Nueva Pieza
                        </Button>
                    </div>
                </div>

                {/* Quick Add toast */}
                {quickAddToast && (
                    <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${quickAddToast.type === 'success'
                        ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400'
                        : 'border-red-900/50 bg-red-950/20 text-red-400'
                        }`}>
                        {quickAddToast.type === 'success'
                            ? <Check className="h-3.5 w-3.5 flex-shrink-0" />
                            : <span className="flex-shrink-0">⚠</span>
                        }
                        {quickAddToast.message}
                    </div>
                )}

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

            {/* ── Two-column Moka layout ── */}
            <div className="flex gap-4 items-start">

                {/* ── LEFT: Reels grid (2/3) ── */}
                <div className="flex-[2] min-w-0 space-y-3">
                    {/* Sort controls */}
                    <div className="flex items-center gap-1.5">
                        <ArrowUpDown className="h-3.5 w-3.5 text-zinc-600 flex-shrink-0" />
                        {SORT_OPTIONS.map((opt) => (
                            <button
                                key={opt.key}
                                onClick={() => setSortBy(opt.key)}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${sortBy === opt.key
                                    ? 'bg-white/[0.08] text-zinc-100 border border-white/[0.12]'
                                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {sortedPieces.length === 0 ? (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-12 text-center text-zinc-500 text-sm">
                            Sin piezas de contenido registradas
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-3">
                            {(() => {
                                const totalV = sortedPieces.reduce((sum, cp) => sum + (cp.views || 0), 0)
                                const avgViews = sortedPieces.length > 0 ? totalV / sortedPieces.length : 1

                                return sortedPieces.map((cp) => {
                                    const metric = metricsMap.get(cp.id)
                                    const hasMetrics = !!metric
                                    const multiplier = avgViews > 0 ? (cp.views || 0) / avgViews : 0
                                    const multiplierColor =
                                        multiplier >= 1.5
                                            ? 'bg-emerald-500/80 text-emerald-50'
                                            : multiplier >= 1.0
                                                ? 'bg-amber-500/80 text-amber-50'
                                                : 'bg-red-500/80 text-red-50'
                                    // Only show IG link if it's actually an Instagram URL
                                    const reelUrl = cp.ig_permalink?.includes('instagram.com')
                                        ? cp.ig_permalink
                                        : undefined

                                    return (
                                        <div
                                            key={cp.id}
                                            className="group relative rounded-xl border overflow-hidden flex flex-col transition-all duration-300"
                                            style={hasMetrics
                                                ? {
                                                    border: '1px solid rgba(52,211,153,0.15)',
                                                    background: 'linear-gradient(160deg, rgba(255,69,58,0.06) 0%, rgba(0,0,0,0.5) 60%)',
                                                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.5)',
                                                }
                                                : {
                                                    border: '1px solid rgba(255,255,255,0.06)',
                                                    background: 'linear-gradient(160deg, rgba(255,69,58,0.05) 0%, rgba(0,0,0,0.5) 60%)',
                                                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.5)',
                                                }
                                            }
                                        >
                                            {/* Thumbnail */}
                                            <button
                                                onClick={() => setSelectedPiece(cp)}
                                                className="relative aspect-[9/16] w-full overflow-hidden rounded-t-xl bg-zinc-800 focus-visible:outline-none"
                                            >
                                                {cp.ig_thumbnail_url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={cp.ig_thumbnail_url}
                                                        alt={cp.caption || cp.content_type}
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center">
                                                        <Play className="h-8 w-8 text-zinc-600" />
                                                        {cp.keyword_trigger && (
                                                            <span className="font-mono text-sm font-bold text-zinc-400">
                                                                {cp.keyword_trigger}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
                                                            {contentTypeLabel[cp.content_type] || cp.content_type}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Multiplier badge — top left (only when views > 0) */}
                                                {(cp.views || 0) > 0 && (
                                                    <span className={`absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold ${multiplierColor}`}>
                                                        ×{multiplier.toFixed(1)}
                                                    </span>
                                                )}

                                                {/* Has-metrics indicator — top right */}
                                                {hasMetrics && (
                                                    <div className="absolute top-2 right-2">
                                                        <CheckCircle2 className="h-4 w-4 text-emerald-400 drop-shadow" />
                                                    </div>
                                                )}

                                                {/* Add metrics overlay on hover */}
                                                {!hasMetrics && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity [@media(hover:none)]:hidden">
                                                        <Plus className="h-6 w-6 text-white" />
                                                    </div>
                                                )}
                                            </button>

                                            {/* Card body */}
                                            <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                                                {/* Views — big (only when > 0) */}
                                                {(cp.views || 0) > 0 && (
                                                    <p className="font-mono text-lg font-bold text-zinc-100 leading-none">
                                                        {formatNumber(cp.views)}
                                                    </p>
                                                )}

                                                {/* Engagement row — only show metrics with value > 0 */}
                                                <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                                                    {(cp.likes || 0) > 0 && (
                                                        <span className="flex items-center gap-0.5">
                                                            <Heart className="h-3 w-3" />
                                                            {formatNumber(cp.likes)}
                                                        </span>
                                                    )}
                                                    {(cp.comments || 0) > 0 && (
                                                        <span className="flex items-center gap-0.5">
                                                            <MessageCircle className="h-3 w-3" />
                                                            {formatNumber(cp.comments)}
                                                        </span>
                                                    )}
                                                    {(cp.shares || 0) > 0 && (
                                                        <span className="flex items-center gap-0.5">
                                                            <Share2 className="h-3 w-3" />
                                                            {formatNumber(cp.shares)}
                                                        </span>
                                                    )}
                                                    {(cp.saves || 0) > 0 && (
                                                        <span className="flex items-center gap-0.5">
                                                            <Bookmark className="h-3 w-3" />
                                                            {formatNumber(cp.saves)}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Caption */}
                                                {cp.caption && (
                                                    <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                                        {cp.caption}
                                                    </p>
                                                )}

                                                {/* Funnel metrics if available */}
                                                {hasMetrics && metric && (
                                                    <div className="flex items-center gap-1.5">
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

                                                {/* Action row */}
                                                <div className="mt-auto flex items-center gap-1.5 pt-0.5">
                                                    {/* Delete button */}
                                                    <button
                                                        onClick={(e) => handleDelete(e, cp)}
                                                        disabled={deleting === cp.id}
                                                        className="rounded-md bg-zinc-800/60 border border-zinc-700 p-1.5 text-zinc-500 hover:text-red-400 hover:border-red-900/50 transition-colors"
                                                        title="Eliminar pieza"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>

                                                    {/* Ver en IG */}
                                                    {reelUrl && (
                                                        <a
                                                            href={reelUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                                                        >
                                                            <ExternalLink className="h-3 w-3" />
                                                            Ver en IG
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            })()}
                        </div>
                    )}
                </div>

                {/* ── RIGHT: Analytics sidebar (1/3) sticky ── */}
                <div className="w-72 flex-shrink-0 sticky top-4">
                    <ContentAnalyticsSidebar analytics={contentAnalytics} />
                </div>
            </div>

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
