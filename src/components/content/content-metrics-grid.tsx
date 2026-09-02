'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ContentFunnelForm, type ContentMetric } from './content-funnel-form'
import { ContentPieceForm } from './content-piece-form'
import { ContentAnalyticsSidebar } from './content-analytics-sidebar'
import { ContentConversationTable } from './content-conversation-table'
import { deleteContentAction, getContentTabData } from '@/lib/actions/content'
import { syncClientContent } from '@/lib/actions/instagram'
import { getInteractions } from '@/lib/actions/interactions'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { BarChart2, CheckCircle2, Plus, Trash2, Pencil, Link2, Copy, Check, ChevronDown, ChevronUp, RefreshCw, Heart, MessageCircle, MessageSquare, Share2, Bookmark, ExternalLink, Play, ArrowUpDown, Eye, Rocket, ThumbsUp, TrendingDown } from 'lucide-react'
import type { ContentPiece, Interaction } from '@/lib/types'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'
import type { ClientFunnelTotals } from '@/lib/actions/metrics'

// ── Webhook Integration Banner ────────────────────────────────────────────────

const WEBHOOK_PATH = '/api/webhooks/manychat'

const PAYLOAD_EXAMPLE = `{
  "ig_username": "usuario_ig",
  "full_name": "Nombre Apellido",
  "subscriber_id": "manychat_subscriber_id"
}`

function WebhookUrlRow({ label, hint, url }: { label: string; hint: string; url: string }) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // fallback: select text
        }
    }

    return (
        <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <code className="flex-1 text-xs text-zinc-300 font-mono truncate">{url}</code>
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
            <p className="text-[11px] text-zinc-600 leading-snug">{hint}</p>
        </div>
    )
}

function WebhookBanner() {
    const [expanded, setExpanded] = useState(false)

    const baseUrl = typeof window !== 'undefined'
        ? `${window.location.origin}${WEBHOOK_PATH}`
        : WEBHOOK_PATH
    const conversacionUrl = `${baseUrl}/{keyword_trigger}`
    const chatAbiertoUrl = `${baseUrl}/{keyword_trigger}/chat-abierto`
    const leadCalificadoUrl = `${baseUrl}/{keyword_trigger}/lead-calificado`

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
                    <p className="mt-3 text-[11px] text-zinc-600 leading-snug">
                        Reemplazá <span className="font-mono text-zinc-500">{'{keyword_trigger}'}</span> con el ID de la pieza (ej: C_21_04, R_19_04, H_13_07). Cada pieza tiene sus tres propias URLs — la que uses depende de dónde pongas el nodo &ldquo;Solicitud externa&rdquo; en el flujo de ManyChat, no del contenido del body.
                    </p>

                    <WebhookUrlRow
                        label="1. Conversación real (nodo existente, después de que responda)"
                        hint="Es la URL que ya tenías configurada en la rama donde el prospecto responde — sigue igual, no hay que tocarla."
                        url={conversacionUrl}
                    />

                    <WebhookUrlRow
                        label="2. Chat abierto (nodo nuevo, junto al disparador/CTA)"
                        hint="Agrega este nodo apenas entra al flujo — cada llamado cuenta como un chat abierto."
                        url={chatAbiertoUrl}
                    />

                    <WebhookUrlRow
                        label="3. Lead calificado (nodo nuevo, en el momento en que califica)"
                        hint="Agrega este nodo donde el flujo marca al prospecto como calificado — promueve la interacción existente en vez de duplicarla."
                        url={leadCalificadoUrl}
                    />

                    {/* Payload structure */}
                    <div className="space-y-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                            Estructura del Payload (JSON) — igual para las tres URLs
                        </p>
                        <pre className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-[11px] font-mono text-zinc-400 overflow-x-auto leading-relaxed">
                            {PAYLOAD_EXAMPLE}
                        </pre>
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
    funnelTotals: ClientFunnelTotals
    reload: () => void
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
    post: 'Carrusel',
    live: 'Bio',
    trial: 'Trial',
}

function formatDayLabel(dateKey: string): string {
    const d = new Date(`${dateKey}T00:00:00`)
    if (Number.isNaN(d.getTime())) return dateKey
    return d.toLocaleDateString('es-419', { day: 'numeric', month: 'short' })
}

// 'YYYY-MM' -> 'agosto 2026'. Pieces without published_at fall outside any
// month filter (never silently swallowed, always visible under "Todos").
function formatMonthLabel(monthKey: string): string {
    const d = new Date(`${monthKey}-01T00:00:00`)
    if (Number.isNaN(d.getTime())) return monthKey
    const label = d.toLocaleDateString('es-419', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
}

function monthsWithData(pieces: ContentPiece[]): string[] {
    const months = new Set<string>()
    for (const cp of pieces) {
        if (cp.published_at) months.add(cp.published_at.slice(0, 7))
    }
    return Array.from(months).sort().reverse()
}

type SortKey = 'recent' | 'views' | 'revenue' | 'comments'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'recent', label: 'Recientes' },
    { key: 'views', label: 'Vistas' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'comments', label: 'Comentarios' },
]

type TypeFilter = 'all' | 'reel' | 'story' | 'post' | 'live' | 'trial'

const TYPE_FILTER_OPTIONS: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: 'Todo' },
    { key: 'reel', label: 'Reels' },
    { key: 'story', label: 'Historias' },
    { key: 'post', label: 'Carruseles' },
    { key: 'live', label: 'Bio' },
    { key: 'trial', label: 'Trials' },
]

// A grid slot is either a single piece, or (Historias only) every story
// published on the same day collapsed into one card.
type GridItem =
    | { kind: 'piece'; piece: ContentPiece }
    | { kind: 'story-day'; dateKey: string; pieces: ContentPiece[] }

// ── Grouped stories card — one day, multiple stories ──────────────────────
function StoryDayCard({
    pieces,
    dateKey,
    expanded,
    onToggle,
    metricsMap,
    revenueByContentId,
    chatCountsByPiece,
    onSelectPiece,
    onEditPiece,
    onDeletePiece,
    deletingId,
}: {
    pieces: ContentPiece[]
    dateKey: string
    expanded: boolean
    onToggle: () => void
    metricsMap: Map<string, ContentMetric>
    revenueByContentId: ContentAnalytics['revenue_by_content_id']
    chatCountsByPiece: Map<string, { chats: number; conversaciones: number }>
    onSelectPiece: (p: ContentPiece) => void
    onEditPiece: (p: ContentPiece) => void
    onDeletePiece: (e: React.MouseEvent, p: ContentPiece) => void
    deletingId: string | null
}) {
    const totals = pieces.reduce(
        (acc, p) => {
            const rev = revenueByContentId[p.id]
            return {
                views: acc.views + (p.views || 0),
                likes: acc.likes + (p.likes || 0),
                comments: acc.comments + (p.comments || 0),
                shares: acc.shares + (p.shares || 0),
                saves: acc.saves + (p.saves || 0),
                agendas: acc.agendas + (rev?.agendas || 0),
                shows: acc.shows + (rev?.shows || 0),
                cierres: acc.cierres + (rev?.cierres || 0),
                revenue: acc.revenue + (rev?.revenue || 0),
            }
        },
        { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, agendas: 0, shows: 0, cierres: 0, revenue: 0 }
    )
    const cover = pieces.find((p) => p.ig_thumbnail_url)?.ig_thumbnail_url

    return (
        <div
            className="group relative rounded-xl border overflow-hidden flex flex-col transition-all duration-300"
            style={{
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'linear-gradient(160deg, rgba(255,69,58,0.05) 0%, rgba(0,0,0,0.5) 60%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.5)',
            }}
        >
            <button
                onClick={onToggle}
                className="relative aspect-square w-full overflow-hidden rounded-t-xl bg-zinc-800 focus-visible:outline-none"
            >
                {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt={`Historias del ${formatDayLabel(dateKey)}`} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center">
                        <Play className="h-8 w-8 text-zinc-600" />
                        <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">Historias</span>
                    </div>
                )}
                <span className="absolute top-2 left-2 rounded-md bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-200">
                    {pieces.length} historias
                </span>
                <span className="absolute bottom-2 left-2 rounded-md bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-200">
                    {formatDayLabel(dateKey)}
                </span>
            </button>

            <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                {totals.views > 0 && (
                    <p className="font-mono text-lg font-bold text-zinc-100 leading-none">{formatNumber(totals.views)}</p>
                )}
                <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                    {totals.likes > 0 && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatNumber(totals.likes)}</span>}
                    {totals.comments > 0 && <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatNumber(totals.comments)}</span>}
                    {totals.shares > 0 && <span className="flex items-center gap-0.5"><Share2 className="h-3 w-3" />{formatNumber(totals.shares)}</span>}
                    {totals.saves > 0 && <span className="flex items-center gap-0.5"><Bookmark className="h-3 w-3" />{formatNumber(totals.saves)}</span>}
                </div>

                {(totals.agendas > 0 || totals.shows > 0 || totals.cierres > 0 || totals.revenue > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        {totals.agendas > 0 && <span className="text-[10px] text-blue-400 font-mono">{totals.agendas} agenda{totals.agendas !== 1 ? 's' : ''}</span>}
                        {totals.shows > 0 && <span className="text-[10px] text-amber-400 font-mono">{totals.shows} show{totals.shows !== 1 ? 's' : ''}</span>}
                        {totals.cierres > 0 && <span className="text-[10px] text-emerald-500 font-mono">{totals.cierres} cierre{totals.cierres !== 1 ? 's' : ''}</span>}
                        {totals.revenue > 0 && <span className="text-[10px] text-emerald-600 font-mono">{formatCurrency(totals.revenue)}</span>}
                    </div>
                )}

                <button
                    onClick={onToggle}
                    className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expanded ? 'Ocultar historias' : `Ver las ${pieces.length} historias`}
                </button>

                {expanded && (
                    <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
                        {pieces.map((p) => {
                            const hasMetrics = metricsMap.has(p.id)
                            const chats = chatCountsByPiece.get(p.id)
                            return (
                                <div
                                    key={p.id}
                                    onClick={() => onSelectPiece(p)}
                                    className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04] cursor-pointer transition-colors"
                                >
                                    <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
                                        {p.ig_thumbnail_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={p.ig_thumbnail_url} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <Play className="h-3 w-3 text-zinc-600 absolute inset-0 m-auto" />
                                        )}
                                        {hasMetrics && <CheckCircle2 className="absolute -top-0.5 -right-0.5 h-3 w-3 text-emerald-400 drop-shadow" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-mono text-zinc-200 truncate">{formatNumber(p.views)} vistas</p>
                                        {chats && chats.chats > 0 && (
                                            <p className="text-[10px] font-mono text-violet-400/80">{formatNumber(chats.chats)} chats</p>
                                        )}
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onEditPiece(p) }}
                                        className="rounded-md bg-zinc-800/60 border border-zinc-700 p-1 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 transition-colors flex-shrink-0"
                                        title="Editar pieza"
                                    >
                                        <Pencil className="h-2.5 w-2.5" />
                                    </button>
                                    <button
                                        onClick={(e) => onDeletePiece(e, p)}
                                        disabled={deletingId === p.id}
                                        className="rounded-md bg-zinc-800/60 border border-zinc-700 p-1 text-zinc-500 hover:text-red-400 hover:border-red-900/50 transition-colors flex-shrink-0"
                                        title="Eliminar pieza"
                                    >
                                        <Trash2 className="h-2.5 w-2.5" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export function ContentMetricsGrid({ contentPieces, contentMetrics, clientId, contentAnalytics, funnelTotals, reload }: Props) {
    const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null)
    const [showNewPieceForm, setShowNewPieceForm] = useState(false)
    const [editingPiece, setEditingPiece] = useState<ContentPiece | null>(null)
    const [deleting, setDeleting] = useState<string | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [syncToast, setSyncToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [sortBy, setSortBy] = useState<SortKey>('recent')
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
    const [interactions, setInteractions] = useState<Interaction[]>([])
    const [expandedStoryDays, setExpandedStoryDays] = useState<Set<string>>(new Set())
    // Defaults to the most recent month that actually has pieces — old
    // months (e.g. a July piece like H_23_07 sitting there in August)
    // otherwise stay mixed in with the current month's and get confused
    // for it. "Todos los meses" is always one click away.
    const [monthFilter, setMonthFilter] = useState<string>(() => monthsWithData(contentPieces)[0] ?? 'all')
    const router = useRouter()

    function toggleStoryDay(dateKey: string) {
        setExpandedStoryDays((prev) => {
            const next = new Set(prev)
            if (next.has(dateKey)) next.delete(dateKey)
            else next.add(dateKey)
            return next
        })
    }

    // Fetched here instead of received as a prop — clients/[id]/page.tsx no
    // longer pulls the whole interactions table (a dozen-plus paginated
    // requests on a busy client) into the initial page load just for this
    // tab's per-piece chat counts.
    useEffect(() => {
        let cancelled = false
        getInteractions(clientId)
            .then((data) => { if (!cancelled) setInteractions(data as unknown as Interaction[]) })
            .catch((err) => { if (!cancelled) console.error('[ContentMetricsGrid] getInteractions failed', err) })
        return () => { cancelled = true }
    }, [clientId])

    // Per-piece Chats/Conversaciones, live from interactions (all-time,
    // matching the all-time views/likes/etc. already on each piece)
    const interactionCountsByPiece = useMemo(() => {
        const counts = new Map<string, { chats: number; conversaciones: number }>()
        for (const i of interactions ?? []) {
            if (!i.content_id) continue
            const entry = counts.get(i.content_id) ?? { chats: 0, conversaciones: 0 }
            entry.chats += 1
            if (i.classification === 'conversacion_real' || i.classification === 'lead_calificado') entry.conversaciones += 1
            counts.set(i.content_id, entry)
        }
        return counts
    }, [interactions])

    async function handleSync() {
        setSyncing(true)
        setSyncToast(null)
        try {
            const result = await syncClientContent(clientId)
            setSyncToast({ type: result.status === 'success' ? 'success' : 'error', message: result.message })
            if (result.status === 'success') { router.refresh(); reload() }
        } catch (err) {
            setSyncToast({ type: 'error', message: err instanceof Error ? err.message : 'Error inesperado' })
        } finally {
            setSyncing(false)
            setTimeout(() => setSyncToast(null), 5000)
        }
    }

    async function handleDelete(e: React.MouseEvent, piece: ContentPiece) {
        e.stopPropagation()
        if (!confirm(`¿Eliminar "${piece.caption || piece.keyword_trigger || 'esta pieza'}"?\nSe borrarán también sus métricas asociadas.`)) return
        setDeleting(piece.id)
        try {
            await deleteContentAction(piece.id, clientId)
            router.refresh()
            reload()
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

    const availableMonths = monthsWithData(contentPieces)

    // Filter by content type and month, then sort client-side. Trials are
    // their own category — never shown under "Todo" (they'd otherwise also
    // be indistinguishable from Reels there, since they use the same
    // vertical format) and, since they're a distinct content_type, already
    // excluded from the "Reels" filter automatically. A piece with no
    // published_at never gets hidden by the month filter — only shows up
    // under "Todos los meses", where nothing is filtered.
    const filteredPieces = contentPieces.filter((cp) => {
        const typeOk = typeFilter === 'all' ? cp.content_type !== 'trial' : cp.content_type === typeFilter
        if (!typeOk) return false
        if (monthFilter === 'all') return true
        return cp.published_at?.slice(0, 7) === monthFilter
    })

    const sortedPieces = [...filteredPieces].sort((a, b) => {
        if (sortBy === 'views') return (b.views || 0) - (a.views || 0)
        if (sortBy === 'comments') return (b.comments || 0) - (a.comments || 0)
        if (sortBy === 'revenue') {
            const aRev = contentAnalytics.revenue_by_content_id[a.id]?.revenue || 0
            const bRev = contentAnalytics.revenue_by_content_id[b.id]?.revenue || 0
            return bRev - aRev
        }
        // 'recent' — server already sorted by published_at desc, preserve order
        return 0
    })

    // Stories post several times a day, which used to flood the grid with
    // near-duplicate cards — group same-day stories into one card (a single
    // story on a given day still renders as a normal card, no group needed).
    const gridItems: GridItem[] = useMemo(() => {
        const items: GridItem[] = []
        const dayBuckets = new Map<string, ContentPiece[]>()

        for (const cp of sortedPieces) {
            if (cp.content_type !== 'story') {
                items.push({ kind: 'piece', piece: cp })
                continue
            }
            const dateKey = cp.published_at ? cp.published_at.slice(0, 10) : cp.id
            let bucket = dayBuckets.get(dateKey)
            if (!bucket) {
                bucket = []
                dayBuckets.set(dateKey, bucket)
                items.push({ kind: 'story-day', dateKey, pieces: bucket })
            }
            bucket.push(cp)
        }

        // Collapse single-story days back into a plain card — no group UI needed for just one
        return items.map((item) =>
            item.kind === 'story-day' && item.pieces.length === 1
                ? { kind: 'piece', piece: item.pieces[0] }
                : item
        )
    }, [sortedPieces])

    // Funnel data from the real sources: views from content_pieces,
    // chats/convs/agendas from interactions, shows/cierres from agenda_records
    const totalViews = funnelTotals.views || contentPieces.reduce((sum, cp) => sum + (cp.views || 0), 0)

    const selectedMetric = selectedPiece ? (metricsMap.get(selectedPiece.id) ?? null) : null

    return (
        <div className="space-y-4">
            {/* ── Funnel Banner ── */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-zinc-400" />
                        <h3 className="text-sm font-semibold text-zinc-300">Embudo Agregado del Cliente</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {funnelTotals.cash > 0 && (
                            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40 rounded-md px-2 py-0.5">
                                {formatCurrency(funnelTotals.cash)} cobrado
                            </span>
                        )}
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleSync}
                            disabled={syncing}
                            title="Sincronizar vistas/likes/comentarios reales desde la Graph API de Instagram (usa el Instagram Account ID del cliente)"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                            {syncing ? 'Sincronizando...' : 'Sincronizar'}
                        </Button>
                        <Button size="sm" onClick={() => setShowNewPieceForm(true)}>
                            <Plus className="h-3.5 w-3.5" />
                            Nueva Pieza
                        </Button>
                    </div>
                </div>

                {/* Sync toast */}
                {syncToast && (
                    <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${syncToast.type === 'success'
                        ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400'
                        : 'border-red-900/50 bg-red-950/20 text-red-400'
                        }`}>
                        {syncToast.type === 'success'
                            ? <Check className="h-3.5 w-3.5 flex-shrink-0" />
                            : <span className="flex-shrink-0">⚠</span>
                        }
                        {syncToast.message}
                    </div>
                )}

                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    <FunnelStep label="Views" value={totalViews} />
                    <FunnelArrow />
                    <FunnelStep
                        label="Chats"
                        value={funnelTotals.chats}
                        rate={pct(funnelTotals.chats, totalViews)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Convs."
                        value={funnelTotals.conversaciones}
                        rate={pct(funnelTotals.conversaciones, funnelTotals.chats)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Agendas"
                        value={funnelTotals.agendas}
                        rate={pct(funnelTotals.agendas, funnelTotals.conversaciones)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Shows"
                        value={funnelTotals.shows}
                        rate={pct(funnelTotals.shows, funnelTotals.agendas)}
                    />
                    <FunnelArrow />
                    <FunnelStep
                        label="Cierres"
                        value={funnelTotals.cierres}
                        rate={pct(funnelTotals.cierres, funnelTotals.shows)}
                        highlight
                    />
                </div>
            </div>

            {/* ── Webhook Integration Banner ── */}
            <WebhookBanner />

            {/* ── Chats → Conversaciones diagnostic, per piece ── */}
            <ContentConversationTable contentPieces={contentPieces} interactions={interactions ?? []} />

            {/* ── Two-column Moka layout ── */}
            <div className="flex flex-col gap-4 items-start lg:flex-row">

                {/* ── LEFT: Reels grid (2/3) ── */}
                <div className="w-full lg:flex-[2] min-w-0 space-y-3">
                    {/* Type filter + sort controls */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                            {TYPE_FILTER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.key}
                                    onClick={() => setTypeFilter(opt.key)}
                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${typeFilter === opt.key
                                        ? 'bg-white/[0.08] text-zinc-100 border border-white/[0.12]'
                                        : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {availableMonths.length > 0 && (
                            <>
                                <div className="h-4 w-px bg-zinc-800" />
                                <select
                                    value={monthFilter}
                                    onChange={(e) => setMonthFilter(e.target.value)}
                                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 [&>option]:bg-zinc-900"
                                >
                                    <option value="all">Todos los meses</option>
                                    {availableMonths.map((m) => (
                                        <option key={m} value={m}>{formatMonthLabel(m)}</option>
                                    ))}
                                </select>
                            </>
                        )}
                        <div className="h-4 w-px bg-zinc-800" />
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
                    </div>

                    {gridItems.length === 0 ? (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-12 text-center text-zinc-500 text-sm">
                            {monthFilter !== 'all' && contentPieces.length > 0
                                ? <>Sin piezas en {formatMonthLabel(monthFilter).toLowerCase()} —{' '}
                                    <button onClick={() => setMonthFilter('all')} className="text-zinc-300 underline hover:text-zinc-100">ver todos los meses</button>
                                  </>
                                : 'Sin piezas de contenido registradas'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {(() => {
                                const itemViews = (item: GridItem) => item.kind === 'piece'
                                    ? (item.piece.views || 0)
                                    : item.pieces.reduce((sum, p) => sum + (p.views || 0), 0)
                                const totalV = gridItems.reduce((sum, item) => sum + itemViews(item), 0)
                                const avgViews = gridItems.length > 0 ? totalV / gridItems.length : 1

                                return gridItems.map((item) => {
                                    if (item.kind === 'story-day') {
                                        return (
                                            <StoryDayCard
                                                key={item.dateKey}
                                                pieces={item.pieces}
                                                dateKey={item.dateKey}
                                                expanded={expandedStoryDays.has(item.dateKey)}
                                                onToggle={() => toggleStoryDay(item.dateKey)}
                                                metricsMap={metricsMap}
                                                revenueByContentId={contentAnalytics.revenue_by_content_id}
                                                chatCountsByPiece={interactionCountsByPiece}
                                                onSelectPiece={setSelectedPiece}
                                                onEditPiece={setEditingPiece}
                                                onDeletePiece={handleDelete}
                                                deletingId={deleting}
                                            />
                                        )
                                    }

                                    const cp = item.piece
                                    const metric = metricsMap.get(cp.id)
                                    const hasMetrics = !!metric
                                    const revenueStats = contentAnalytics.revenue_by_content_id[cp.id]
                                    const chatStats = interactionCountsByPiece.get(cp.id)
                                    const multiplier = avgViews > 0 ? (cp.views || 0) / avgViews : 0
                                    const multiplierTier = multiplier >= 1.5 ? 'high' : multiplier >= 1.0 ? 'mid' : 'low'
                                    const multiplierColor =
                                        multiplierTier === 'high'
                                            ? 'bg-emerald-500/80 text-emerald-50'
                                            : multiplierTier === 'mid'
                                                ? 'bg-amber-500/80 text-amber-50'
                                                : 'bg-red-500/80 text-red-50'
                                    const MultiplierIcon = multiplierTier === 'high' ? Rocket : multiplierTier === 'mid' ? ThumbsUp : TrendingDown
                                    const hasStatsOverlay = (cp.views || 0) > 0 || (cp.likes || 0) > 0 || (cp.comments || 0) > 0 || (cp.shares || 0) > 0 || (cp.saves || 0) > 0
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
                                            {/* Thumbnail — one uniform square crop for every content type, so a
                                                vertical Reel/Historia doesn't tower over a square carousel in the
                                                grid. object-cover below centers and crops the source without
                                                stretching it. */}
                                            <button
                                                onClick={() => setSelectedPiece(cp)}
                                                className="relative w-full aspect-square overflow-hidden rounded-t-xl bg-zinc-800 focus-visible:outline-none"
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
                                                        <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
                                                            {contentTypeLabel[cp.content_type] || cp.content_type}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Multiplier badge — top left (only when views > 0) */}
                                                {(cp.views || 0) > 0 && (
                                                    <span className={`absolute top-2 left-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold ${multiplierColor}`}>
                                                        <MultiplierIcon className="h-2.5 w-2.5" />
                                                        {multiplier.toFixed(1)}x
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
                                                    <div className="hidden">
                                                        <Plus className="h-6 w-6 text-white" />
                                                    </div>
                                                )}

                                                {/* Stats overlay — views/likes/comments/shares/saves live on the
                                                    cover itself (like a reel's own stats), not in the card body.
                                                    Gradient scrim keeps the white text legible over any image. */}
                                                {hasStatsOverlay && (
                                                    <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                                                        {(cp.views || 0) > 0 && (
                                                            <p className="flex items-center gap-1 text-xs font-mono font-bold text-white">
                                                                <Eye className="h-3 w-3" />
                                                                {formatNumber(cp.views)}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-200">
                                                            {(cp.likes || 0) > 0 && (
                                                                <span className="flex items-center gap-0.5">
                                                                    <Heart className="h-2.5 w-2.5" />
                                                                    {formatNumber(cp.likes)}
                                                                </span>
                                                            )}
                                                            {(cp.comments || 0) > 0 && (
                                                                <span className="flex items-center gap-0.5">
                                                                    <MessageCircle className="h-2.5 w-2.5" />
                                                                    {formatNumber(cp.comments)}
                                                                </span>
                                                            )}
                                                            {(cp.shares || 0) > 0 && (
                                                                <span className="flex items-center gap-0.5">
                                                                    <Share2 className="h-2.5 w-2.5" />
                                                                    {formatNumber(cp.shares)}
                                                                </span>
                                                            )}
                                                            {(cp.saves || 0) > 0 && (
                                                                <span className="flex items-center gap-0.5">
                                                                    <Bookmark className="h-2.5 w-2.5" />
                                                                    {formatNumber(cp.saves)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* CTA tag — sits above the scrim, opposite corner from the stats */}
                                                {cp.keyword_trigger && (
                                                    <span className="absolute bottom-1.5 right-2 rounded-md bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-200">
                                                        {cp.keyword_trigger}
                                                    </span>
                                                )}
                                            </button>

                                            {/* Card body */}
                                            <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                                                {/* Chats / Conversaciones generated by this specific piece */}
                                                {chatStats && chatStats.chats > 0 && (
                                                    <div className="flex items-center gap-2 text-[11px] font-mono text-violet-400/80">
                                                        <span className="flex items-center gap-0.5" title="Chats abiertos">
                                                            <MessageSquare className="h-3 w-3" />
                                                            {formatNumber(chatStats.chats)}
                                                        </span>
                                                        {chatStats.conversaciones > 0 && (
                                                            <span className="flex items-center gap-0.5 text-emerald-400/80" title="Conversaciones reales">
                                                                <MessageCircle className="h-3 w-3" />
                                                                {formatNumber(chatStats.conversaciones)}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Caption */}
                                                {cp.caption && (
                                                    <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                                        {cp.caption}
                                                    </p>
                                                )}

                                                {/* Revenue attributed to this piece — leads, Agendas (all statuses for agendas/shows, "Cerrado" for revenue), and manual content_metrics, merged */}
                                                {revenueStats && (revenueStats.agendas > 0 || revenueStats.shows > 0 || revenueStats.cierres > 0 || revenueStats.revenue > 0) && (
                                                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                        {revenueStats.agendas > 0 && (
                                                            <span className="text-[10px] text-blue-400 font-mono">
                                                                {revenueStats.agendas} agenda{revenueStats.agendas !== 1 ? 's' : ''}
                                                            </span>
                                                        )}
                                                        {revenueStats.shows > 0 && (
                                                            <>
                                                                {revenueStats.agendas > 0 && <span className="text-[10px] text-zinc-600">·</span>}
                                                                <span className="text-[10px] text-amber-400 font-mono">
                                                                    {revenueStats.shows} show{revenueStats.shows !== 1 ? 's' : ''}
                                                                </span>
                                                            </>
                                                        )}
                                                        {revenueStats.cierres > 0 && (
                                                            <>
                                                                {(revenueStats.agendas > 0 || revenueStats.shows > 0) && <span className="text-[10px] text-zinc-600">·</span>}
                                                                <span className="text-[10px] text-emerald-500 font-mono">
                                                                    {revenueStats.cierres} cierre{revenueStats.cierres !== 1 ? 's' : ''}
                                                                </span>
                                                            </>
                                                        )}
                                                        {revenueStats.revenue > 0 && (
                                                            <>
                                                                {(revenueStats.agendas > 0 || revenueStats.shows > 0 || revenueStats.cierres > 0) && <span className="text-[10px] text-zinc-600">·</span>}
                                                                <span className="text-[10px] text-emerald-600 font-mono">
                                                                    {formatCurrency(revenueStats.revenue)}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Action row */}
                                                <div className="mt-auto flex items-center gap-1.5 pt-0.5">
                                                    {/* Edit button */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingPiece(cp) }}
                                                        className="rounded-md bg-zinc-800/60 border border-zinc-700 p-1.5 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                                                        title="Editar pieza"
                                                    >
                                                        <Pencil className="h-3 w-3" />
                                                    </button>

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

                {/* ── RIGHT: Analytics sidebar (1/3) sticky on desktop only ── */}
                <div className="w-full lg:w-72 lg:flex-shrink-0 lg:sticky lg:top-4">
                    <ContentAnalyticsSidebar analytics={contentAnalytics} />
                </div>
            </div>

            {/* ── Modals ── */}
            {selectedPiece && (
                <ContentFunnelForm
                    contentPiece={selectedPiece}
                    existingMetric={selectedMetric}
                    chatStats={interactionCountsByPiece.get(selectedPiece.id) ?? null}
                    siblingPieces={contentPieces}
                    crmStats={contentAnalytics.revenue_by_content_id[selectedPiece.id] ?? null}
                    onClose={() => setSelectedPiece(null)}
                    onSaved={reload}
                />
            )}
            {showNewPieceForm && (
                <ContentPieceForm
                    clientId={clientId}
                    onClose={() => setShowNewPieceForm(false)}
                    onCreated={reload}
                />
            )}
            {editingPiece && (
                <ContentPieceForm
                    clientId={clientId}
                    editingPiece={editingPiece}
                    onClose={() => setEditingPiece(null)}
                    onCreated={reload}
                />
            )}
        </div>
    )
}

type TabData = Pick<Props, 'contentPieces' | 'contentMetrics' | 'contentAnalytics' | 'funnelTotals'>

// Fetches the Contenido tab's data (pieces, metrics, analytics, funnel
// totals) only once this tab actually opens — clients/[id]/page.tsx no
// longer pulls this in on every page load regardless of the active tab.
// getContentAnalytics/getClientFunnelTotals in particular each do their own
// full paginated content_pieces scan plus several joined lookups, so this
// was real weight on every visit to the client page, not just Contenido.
export function ContentMetricsGridLazy({ clientId }: { clientId: string }) {
    const [data, setData] = useState<TabData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)

    const load = useCallback(() => {
        getContentTabData(clientId).then((result) => setData(result)).catch((err) => console.error('[ContentMetricsGrid] reload failed', err))
    }, [clientId])

    useEffect(() => {
        let cancelled = false
        setError(null)
        getContentTabData(clientId)
            .then((result) => { if (!cancelled) setData(result) })
            .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error inesperado') })
        return () => { cancelled = true }
    }, [clientId, attempt])

    if (error) {
        return (
            <div className="py-16 text-center text-sm">
                <p className="text-red-400 mb-3">No se pudo cargar el contenido ({error}).</p>
                <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>Reintentar</Button>
            </div>
        )
    }

    if (!data) {
        return <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Cargando contenido...</div>
    }

    return <ContentMetricsGrid {...data} clientId={clientId} reload={load} />
}
