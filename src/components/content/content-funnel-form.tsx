'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { upsertContentMetrics } from '@/lib/actions/content'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber, formatPercent } from '@/lib/utils'
import { Eye, Users, Zap, Heart, MessageCircle, Share2, Bookmark, Clock, Filter } from 'lucide-react'
import type { ContentPiece } from '@/lib/types'

export interface ContentMetric {
    id: string
    content_id: string
    client_id: string
    chats_nuevos: number
    conversaciones_nuevas: number
    agendas: number
    shows: number
    cierres: number
    ticket: number | null
    aov: number | null
    cash_collected: number | null
    manychat_label: string | null
    notes: string | null
}

interface Props {
    contentPiece: ContentPiece
    existingMetric?: ContentMetric | null
    chatStats?: { chats: number; conversaciones: number } | null
    siblingPieces?: ContentPiece[]
    crmStats?: { agendas: number; shows: number; cierres: number; revenue: number } | null
    onClose: () => void
    onSaved?: () => void
}

// ── Hero stat card ──────────────────────────────────────────────────────────

function HeroStat({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent?: string }) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-zinc-500">
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-wider">{label}</span>
            </div>
            <p className="font-mono text-xl font-bold leading-none" style={accent ? { color: accent } : undefined}>
                {value}
            </p>
        </div>
    )
}

// ── Ranked bar row — reused for engagement breakdown + retention comparison ──

function RankedBar({
    icon: Icon,
    label,
    value,
    valueLabel,
    maxValue,
    color,
    highlight,
}: {
    icon?: React.ElementType
    label: string
    value: number
    valueLabel: string
    maxValue: number
    color: string
    highlight?: boolean
}) {
    const pct = maxValue > 0 ? (value / maxValue) * 100 : 0
    return (
        <div className="flex items-center gap-2">
            {Icon && <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />}
            <span className={`w-24 flex-shrink-0 truncate text-[11px] ${highlight ? 'text-zinc-200 font-medium' : 'text-zinc-500'}`}>
                {label}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
            <span className={`w-10 flex-shrink-0 text-right text-[11px] font-mono ${highlight ? 'text-zinc-100 font-semibold' : 'text-zinc-400'}`}>
                {valueLabel}
            </span>
        </div>
    )
}

// ── Engagement breakdown ──────────────────────────────────────────────────────
// Fixed categorical order (blue/orange/aqua/yellow) validated for CVD-safe
// adjacency at OKLab ΔE ≥ 8 on this app's zinc-950 surface — icons + direct
// value labels serve as the required secondary encoding for the one pair
// that sits in the 6-8 floor band (yellow↔aqua).
const ENGAGEMENT_COLORS = { likes: '#3987e5', comments: '#d95926', shares: '#199e70', saves: '#c98500' }

function EngagementBreakdown({ likes, comments, shares, saves }: { likes: number; comments: number; shares: number; saves: number }) {
    const rows = [
        { key: 'likes', icon: Heart, label: 'Likes', value: likes, color: ENGAGEMENT_COLORS.likes },
        { key: 'comments', icon: MessageCircle, label: 'Comentarios', value: comments, color: ENGAGEMENT_COLORS.comments },
        { key: 'shares', icon: Share2, label: 'Compartidos', value: shares, color: ENGAGEMENT_COLORS.shares },
        { key: 'saves', icon: Bookmark, label: 'Guardados', value: saves, color: ENGAGEMENT_COLORS.saves },
    ]
    const maxValue = Math.max(...rows.map((r) => r.value), 1)
    const hasData = rows.some((r) => r.value > 0)

    if (!hasData) {
        return <p className="text-[11px] text-zinc-600 py-2">Sin datos de engagement todavía</p>
    }

    return (
        <div className="space-y-2">
            {rows.map((r) => (
                <RankedBar
                    key={r.key}
                    icon={r.icon}
                    label={r.label}
                    value={r.value}
                    valueLabel={formatNumber(r.value)}
                    maxValue={maxValue}
                    color={r.color}
                />
            ))}
        </div>
    )
}

// ── Retention comparison — ranked among this client's other pieces ───────────
// Instagram's Graph API only exposes a single average-watch-time number per
// media (ig_reels_avg_watch_time) — there is no per-second drop-off curve
// available to third-party apps, so "retention" here means ranking this
// piece's average against its siblings, not a moment-by-moment graph.

const RETENTION_OTHER_COLOR = '#52525b' // zinc-600
const RETENTION_HIGHLIGHT_COLOR = '#a78bfa' // violet-400 — matches this modal's own accent (Hook box)

function RetentionComparison({ contentPiece, siblingPieces }: { contentPiece: ContentPiece; siblingPieces: ContentPiece[] }) {
    const seconds = contentPiece.avg_watch_time_seconds
    if (seconds == null) {
        return <p className="text-[11px] text-zinc-600 py-2">Instagram todavía no reportó retención para esta pieza</p>
    }

    const others = siblingPieces
        .filter((p) => p.id !== contentPiece.id && p.avg_watch_time_seconds != null && p.avg_watch_time_seconds > 0)
        .map((p) => ({ id: p.id, seconds: p.avg_watch_time_seconds as number, label: p.keyword_trigger || p.caption || p.content_type }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 6)

    if (others.length === 0) {
        return (
            <div className="space-y-2">
                <p className="font-mono text-2xl font-bold text-zinc-100">{seconds}s</p>
                <p className="text-[11px] text-zinc-600">Necesitas más piezas con retención sincronizada para comparar</p>
            </div>
        )
    }

    const ranked = [...others, { id: contentPiece.id, seconds, label: contentPiece.keyword_trigger || contentPiece.caption || contentPiece.content_type }]
        .sort((a, b) => b.seconds - a.seconds)
    const maxValue = Math.max(...ranked.map((r) => r.seconds), 1)

    return (
        <div className="space-y-2">
            {ranked.map((r) => (
                <RankedBar
                    key={r.id}
                    label={r.id === contentPiece.id ? `${r.label} (esta)` : r.label}
                    value={r.seconds}
                    valueLabel={`${r.seconds}s`}
                    maxValue={maxValue}
                    color={r.id === contentPiece.id ? RETENTION_HIGHLIGHT_COLOR : RETENTION_OTHER_COLOR}
                    highlight={r.id === contentPiece.id}
                />
            ))}
        </div>
    )
}

// ── Per-piece funnel ──────────────────────────────────────────────────────────
// Views/Chats/Conversaciones are real (synced views + interactions table);
// Agendas/Shows/Cierres come from the manual entry below, same as the rest of
// this form — this just visualizes what's already there.
//
// Views dwarfs the steps below it by 2-3 orders of magnitude (a healthy
// funnel: a few hundred chats out of 100K+ views is normal), so a
// proportional-width shape (recharts' Funnel) collapses every step after
// Views into an invisible sliver. Same fix the client-level funnel banner
// above already uses: raw numbers in a chain, with each step's rate relative
// to the *previous* step (not to Views) — that's the number that's actually
// actionable per step.

function FunnelChainStep({ label, value, rate, highlight }: { label: string; value: number; rate?: string; highlight?: boolean }) {
    return (
        <div className="flex flex-col items-center gap-0.5 min-w-[50px]">
            <span className={`font-mono text-base font-semibold ${highlight ? 'text-emerald-400' : 'text-zinc-100'}`}>
                {formatNumber(value)}
            </span>
            <span className="text-[10px] text-zinc-500 whitespace-nowrap">{label}</span>
            {rate && <span className="text-[10px] text-zinc-600 font-mono">{rate}</span>}
        </div>
    )
}

function stepRate(value: number, previous: number): string | undefined {
    if (previous <= 0) return undefined
    return formatPercent((value / previous) * 100)
}

function PieceFunnel({
    views,
    chats,
    conversaciones,
    agendas,
    shows,
    cierres,
}: {
    views: number
    chats: number
    conversaciones: number
    agendas: number
    shows: number
    cierres: number
}) {
    const stages = [
        { key: 'Views', value: views },
        { key: 'Chats', value: chats },
        { key: 'Convs.', value: conversaciones },
        { key: 'Agendas', value: agendas },
        { key: 'Shows', value: shows },
        { key: 'Cierres', value: cierres },
    ]

    if (!stages.some((s) => s.value > 0)) {
        return <p className="text-[11px] text-zinc-600 py-2">Sin datos de embudo todavía</p>
    }

    return (
        <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
            {stages.map((s, i) => (
                <div key={s.key} className="flex items-center">
                    {i > 0 && <span className="px-0.5 text-zinc-700 select-none text-xs">→</span>}
                    <FunnelChainStep
                        label={s.key}
                        value={s.value}
                        rate={i > 0 ? stepRate(s.value, stages[i - 1].value) : undefined}
                        highlight={s.key === 'Cierres'}
                    />
                </div>
            ))}
        </div>
    )
}

// ── Main form ──────────────────────────────────────────────────────────────

export function ContentFunnelForm({ contentPiece, existingMetric, chatStats, siblingPieces, crmStats, onClose, onSaved }: Props) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const formData = new FormData(e.currentTarget)
            await upsertContentMetrics(contentPiece.id, contentPiece.client_id, formData)
            router.refresh()
            onSaved?.()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al guardar métricas')
        } finally {
            setLoading(false)
        }
    }

    const description = [
        contentPiece.caption || contentPiece.content_type,
        contentPiece.keyword_trigger,
    ]
        .filter(Boolean)
        .join(' · ')

    const totalInteractions = contentPiece.total_interactions || (contentPiece.likes + contentPiece.comments + contentPiece.shares + contentPiece.saves)

    return (
        <Dialog
            open
            onClose={onClose}
            title="Métricas de Funnel"
            description={description}
            className="max-w-2xl"
        >
            <div className="space-y-5">
                {/* Hero stats */}
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                        Estadísticas
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <HeroStat icon={Eye} label="Views" value={formatNumber(contentPiece.views)} />
                        <HeroStat icon={Users} label="Alcance" value={formatNumber(contentPiece.reach)} />
                        <HeroStat icon={Zap} label="Interacciones" value={formatNumber(totalInteractions)} />
                        <HeroStat
                            icon={Clock}
                            label="Retención (avg.)"
                            value={contentPiece.avg_watch_time_seconds != null ? `${contentPiece.avg_watch_time_seconds}s` : '—'}
                        />
                    </div>
                    {contentPiece.metrics_source === 'meta_api' && contentPiece.metrics_updated_at && (
                        <p className="mt-2 text-[10px] text-zinc-600">
                            Actualizado automáticamente {new Date(contentPiece.metrics_updated_at).toLocaleString('es-419', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                    )}
                    {contentPiece.content_type === 'story' && contentPiece.story_expires_at && new Date(contentPiece.story_expires_at) < new Date() && (
                        <p className="mt-2 text-[10px] text-amber-500">
                            Esta historia ya expiró — estos son los últimos números que Instagram entregó antes de que desapareciera.
                        </p>
                    )}
                    {contentPiece.hook && (
                        <div className="mt-3 rounded-lg border border-violet-900/40 bg-violet-950/20 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-violet-400/80 mb-1">Hook usado</p>
                            <p className="text-xs text-zinc-300 leading-snug">{contentPiece.hook}</p>
                        </div>
                    )}
                </div>

                {/* Engagement + Retention, side by side */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                            Engagement
                        </p>
                        <EngagementBreakdown
                            likes={contentPiece.likes}
                            comments={contentPiece.comments}
                            shares={contentPiece.shares}
                            saves={contentPiece.saves}
                        />
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                            Retención vs. otras piezas
                        </p>
                        <RetentionComparison contentPiece={contentPiece} siblingPieces={siblingPieces ?? []} />
                    </div>
                </div>

                {/* Funnel chart */}
                <div>
                    <div className="flex items-center gap-1.5 mb-3">
                        <Filter className="h-3.5 w-3.5 text-zinc-500" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                            Embudo de esta pieza
                        </p>
                    </div>
                    <PieceFunnel
                        views={contentPiece.views}
                        chats={chatStats?.chats ?? 0}
                        conversaciones={chatStats?.conversaciones ?? 0}
                        agendas={crmStats?.agendas ?? existingMetric?.agendas ?? 0}
                        shows={crmStats?.shows ?? existingMetric?.shows ?? 0}
                        cierres={crmStats?.cierres ?? existingMetric?.cierres ?? 0}
                    />
                </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                {/* Funnel Section */}
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                        Embudo de Conversión (Manual)
                    </p>
                    <p className="text-[10px] text-zinc-500 mb-3 -mt-2">
                        Si los campos están vacíos, se usarán los valores automáticos del CRM (indicados como placeholder). Completa estos campos solo para sobrescribir los datos automáticos.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <Input
                            id="chats_nuevos"
                            name="chats_nuevos"
                            label="Chats Nuevos"
                            type="number"
                            min="0"
                            placeholder={chatStats?.chats ? chatStats.chats.toString() : "0"}
                            defaultValue={existingMetric?.chats_nuevos ?? ''}
                        />
                        <Input
                            id="conversaciones"
                            name="conversaciones"
                            label="Conversaciones"
                            type="number"
                            min="0"
                            placeholder={chatStats?.conversaciones ? chatStats.conversaciones.toString() : "0"}
                            defaultValue={existingMetric?.conversaciones_nuevas ?? ''}
                        />
                        <Input
                            id="agendas"
                            name="agendas"
                            label="Agendas"
                            type="number"
                            min="0"
                            placeholder={crmStats?.agendas ? crmStats.agendas.toString() : "0"}
                            defaultValue={existingMetric?.agendas ?? ''}
                        />
                        <Input
                            id="shows"
                            name="shows"
                            label="Shows"
                            type="number"
                            min="0"
                            placeholder={crmStats?.shows ? crmStats.shows.toString() : "0"}
                            defaultValue={existingMetric?.shows ?? ''}
                        />
                        <Input
                            id="cierres"
                            name="cierres"
                            label="Cierres"
                            type="number"
                            min="0"
                            placeholder={crmStats?.cierres ? crmStats.cierres.toString() : "0"}
                            defaultValue={existingMetric?.cierres ?? ''}
                        />
                    </div>
                </div>

                {/* Economic Section */}
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                        Métricas Económicas
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                        <Input
                            id="ticket"
                            name="ticket"
                            label="Ticket (USD)"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            defaultValue={existingMetric?.ticket ?? ''}
                        />
                        <Input
                            id="aov"
                            name="aov"
                            label="AOV (USD)"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            defaultValue={existingMetric?.aov ?? ''}
                        />
                        <Input
                            id="cash_collected"
                            name="cash_collected"
                            label="Cash Collected"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={crmStats?.revenue ? crmStats.revenue.toString() : "0.00"}
                            defaultValue={existingMetric?.cash_collected ?? ''}
                        />
                    </div>
                </div>

                {/* Tracking Section */}
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                        Tracking
                    </p>
                    <Input
                        id="manychat_label"
                        name="manychat_label"
                        label="ManyChat Label"
                        placeholder="ej: REEL_JUNIO_OFERTA"
                        defaultValue={existingMetric?.manychat_label ?? ''}
                    />
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                    <label htmlFor="notes" className="block text-sm font-medium text-zinc-400">
                        Notas
                    </label>
                    <textarea
                        id="notes"
                        name="notes"
                        rows={3}
                        placeholder="Observaciones sobre el rendimiento de esta pieza..."
                        defaultValue={existingMetric?.notes ?? ''}
                        className="flex w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 resize-none"
                    />
                </div>

                {error && (
                    <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}

                <div className="flex gap-3 pt-1">
                    <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={loading} className="flex-1">
                        {loading ? 'Guardando...' : 'Guardar Métricas'}
                    </Button>
                </div>
            </form>
            </div>
        </Dialog>
    )
}
