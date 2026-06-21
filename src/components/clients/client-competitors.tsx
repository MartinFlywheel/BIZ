'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { formatNumber } from '@/lib/utils'
import {
    createCompetitorAction,
    deleteCompetitorAction,
    updateCompetitorAnalysis,
} from '@/lib/actions/competitors'
import {
    Plus,
    X,
    Trash2,
    ExternalLink,
    ChevronDown,
    ChevronUp,
    Users,
    RefreshCw,
    Heart,
    Play,
    MessageCircle,
    Share2,
    Bookmark,
    ShoppingBag,
    UserCircle,
    Lightbulb,
} from 'lucide-react'
import type { Competitor, CompetitorReel } from '@/lib/types'

interface Props {
    competitors: Competitor[]
    competitorReels: Record<string, CompetitorReel[]>
    clientId: string
}

// ── Nuevo Competidor Modal ────────────────────────────────────────────────────

function NuevoCompetidorForm({
    clientId,
    onClose,
}: {
    clientId: string
    onClose: () => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const formData = new FormData(e.currentTarget)
            formData.set('client_id', clientId)
            await createCompetitorAction(formData)
            router.refresh()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al crear el competidor')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal onClose={onClose} size="md">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-50 flex items-center gap-2">
                        <Users className="h-4 w-4" /> Nuevo Competidor
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Registrá un competidor para este cliente</p>
                </div>
                <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                    id="name"
                    name="name"
                    label="Nombre *"
                    placeholder="Ej: Academia Barber Pro"
                    required
                />

                <div className="space-y-1.5">
                    <Input
                        id="ig_handle"
                        name="ig_handle"
                        label="Handle de Instagram"
                        placeholder="@barberpro"
                    />
                    <p className="text-[11px] text-zinc-600 leading-snug">
                        Sin el @. Se usará para linkear al perfil y sincronizar reels.
                    </p>
                </div>

                <Textarea
                    id="analisis_estrategico"
                    name="analisis_estrategico"
                    label="Análisis Estratégico"
                    placeholder="Oferta principal, posicionamiento, diferenciación, puntos débiles, ángulos de contenido que usan, precio estimado..."
                    rows={6}
                />

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
                        {loading ? 'Creando...' : 'Crear Competidor'}
                    </Button>
                </div>
            </form>
        </Modal>
    )
}

// ── Competitor Reels Grid ─────────────────────────────────────────────────────

function ReelThumbnail({ url }: { url: string | null }) {
    const [failed, setFailed] = useState(false)

    if (!url || failed) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-800">
                <Play className="h-8 w-8 text-zinc-600" />
            </div>
        )
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={url}
            alt="Reel thumbnail"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
        />
    )
}

function MultiplierBadge({ multiplier }: { multiplier: number }) {
    const color =
        multiplier >= 1.5
            ? 'bg-emerald-500/80 text-emerald-50'
            : multiplier >= 1.0
                ? 'bg-amber-500/80 text-amber-50'
                : 'bg-red-500/80 text-red-50'

    return (
        <span className={`absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold ${color}`}>
            ×{multiplier.toFixed(1)}
        </span>
    )
}

function CompetitorReelsGrid({ reels }: { reels: CompetitorReel[] }) {
    if (reels.length === 0) {
        return (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 py-10 text-center">
                <RefreshCw className="h-6 w-6 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500">Los reels se sincronizan automáticamente via n8n</p>
                <p className="text-xs text-zinc-600 mt-1">Cuando estén disponibles aparecerán aquí</p>
            </div>
        )
    }

    const totalViews = reels.reduce((sum, r) => sum + (r.views || 0), 0)
    const averageViews = reels.length > 0 ? totalViews / reels.length : 1

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {reels.map((reel) => {
                const multiplier = averageViews > 0 ? reel.views / averageViews : 0
                const reelUrl = reel.video_url ?? undefined

                return (
                    <div
                        key={reel.id}
                        className="group rounded-xl border border-white/[0.06] bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] overflow-hidden hover:border-white/[0.1] hover:bg-white/[0.04] transition-all duration-300 flex flex-col"
                    >
                        {/* Thumbnail */}
                        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-t-xl bg-zinc-800">
                            <ReelThumbnail url={reel.thumbnail_url} />

                            {/* Multiplier badge — top left */}
                            <MultiplierBadge multiplier={multiplier} />

                            {/* Duration — bottom right (if available) */}
                            {(reel as CompetitorReel & { duration?: number | null }).duration != null && (
                                <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                                    {(() => {
                                        const d = (reel as CompetitorReel & { duration?: number }).duration!
                                        const m = Math.floor(d / 60)
                                        const s = d % 60
                                        return `${m}:${String(s).padStart(2, '0')}`
                                    })()}
                                </span>
                            )}
                        </div>

                        {/* Card body */}
                        <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                            {/* Views — big */}
                            <p className="font-mono text-lg font-bold text-zinc-100 leading-none">
                                {formatNumber(reel.views)}
                            </p>

                            {/* Engagement row */}
                            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                                <span className="flex items-center gap-0.5">
                                    <Heart className="h-3 w-3" />
                                    {formatNumber(reel.likes)}
                                </span>
                                <span className="flex items-center gap-0.5">
                                    <MessageCircle className="h-3 w-3" />
                                    {formatNumber(reel.comments)}
                                </span>
                                <span className="flex items-center gap-0.5">
                                    <Share2 className="h-3 w-3" />
                                    {formatNumber(reel.shares)}
                                </span>
                                <span className="flex items-center gap-0.5">
                                    <Bookmark className="h-3 w-3" />
                                    {formatNumber(reel.saves)}
                                </span>
                            </div>

                            {/* Caption */}
                            {reel.caption && (
                                <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                    {reel.caption}
                                </p>
                            )}

                            {/* Ver en IG button */}
                            {reelUrl && (
                                <a
                                    href={reelUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-auto flex items-center justify-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                    Ver en IG
                                </a>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ── Analysis Sidebar ──────────────────────────────────────────────────────────

const analysisFieldIcons: Record<'oferta' | 'avatar_target' | 'conclusion', React.ReactNode> = {
    oferta: <ShoppingBag className="h-3 w-3 text-zinc-600" />,
    avatar_target: <UserCircle className="h-3 w-3 text-zinc-600" />,
    conclusion: <Lightbulb className="h-3 w-3 text-zinc-600" />,
}

function AnalysisField({
    label,
    field,
    competitorId,
    initialValue,
}: {
    label: string
    field: 'oferta' | 'avatar_target' | 'conclusion'
    competitorId: string
    initialValue: string | null
}) {
    const [value, setValue] = useState(initialValue ?? '')
    const [saving, setSaving] = useState(false)

    async function handleBlur() {
        if (value === (initialValue ?? '')) return
        setSaving(true)
        try {
            await updateCompetitorAnalysis(competitorId, field, value)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div
            className="rounded-2xl border border-red-950/40 backdrop-blur-xl p-3 space-y-2 relative overflow-hidden"
            style={{
                background: 'linear-gradient(145deg, rgba(255,69,58,0.10) 0%, rgba(120,20,15,0.12) 50%, rgba(0,0,0,0.55) 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,100,80,0.08), 0 0 0 1px rgba(255,69,58,0.08)',
            }}
        >
            {/* ambient red glow top-right */}
            <div className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-red-600/15 blur-3xl" />
            <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-1.5">
                    {analysisFieldIcons[field]}
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-red-400/70">{label}</p>
                </div>
                {saving && <span className="text-[10px] text-zinc-600 font-mono">guardando…</span>}
            </div>
            <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                rows={4}
                placeholder={`${label}…`}
                className="relative z-10 w-full resize-none bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-sm text-zinc-300 placeholder:text-zinc-600 leading-relaxed"
            />
        </div>
    )
}

// ── Competitor Card ───────────────────────────────────────────────────────────

function CompetitorCard({
    competitor,
    reels,
    clientId,
    isExpanded,
    onToggle,
}: {
    competitor: Competitor
    reels: CompetitorReel[]
    clientId: string
    isExpanded: boolean
    onToggle: () => void
}) {
    const [deleting, setDeleting] = useState(false)
    const router = useRouter()

    async function handleDelete(e: React.MouseEvent) {
        e.stopPropagation()
        if (!confirm(`¿Eliminar a "${competitor.name}"? Se borrarán también sus reels.`)) return
        setDeleting(true)
        try {
            await deleteCompetitorAction(competitor.id, clientId)
            router.refresh()
        } catch {
            alert('Error al eliminar')
        } finally {
            setDeleting(false)
        }
    }

    const igHandle = competitor.ig_handle?.replace(/^@/, '')

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden transition-all">
            {/* Card header — always visible */}
            <button
                onClick={onToggle}
                className="w-full flex items-start gap-4 p-4 hover:bg-zinc-800/40 transition-colors text-left"
            >
                {/* Avatar placeholder */}
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                    <span className="text-sm font-semibold text-zinc-400">
                        {competitor.name.charAt(0).toUpperCase()}
                    </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-100 truncate">{competitor.name}</p>
                        {igHandle && (
                            <a
                                href={`https://instagram.com/${igHandle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
                            >
                                @{igHandle}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                    </div>
                    {competitor.analisis_estrategico && (
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">
                            {competitor.analisis_estrategico}
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded"
                        title="Eliminar competidor"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isExpanded
                        ? <ChevronUp className="h-4 w-4 text-zinc-500" />
                        : <ChevronDown className="h-4 w-4 text-zinc-500" />
                    }
                </div>
            </button>

            {/* Expanded: two-column layout */}
            {isExpanded && (
                <div className="border-t border-zinc-800 px-4 pb-4" style={{ background: 'radial-gradient(ellipse 120% 80% at 50% 0%, rgba(255,69,58,0.07) 0%, rgba(255,69,58,0.02) 40%, transparent 70%)' }}>
                    <div className="flex gap-4 pt-4 items-start">
                        {/* Left: scrollable reels grid (2/3) */}
                        <div className="flex-[2] min-w-0 overflow-y-auto max-h-[80vh] border-r border-white/[0.04] pr-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-3">
                                Reels del Competidor
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                                {reels.length === 0 ? (
                                    <div className="col-span-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 py-10 text-center">
                                        <RefreshCw className="h-6 w-6 text-zinc-700 mx-auto mb-3" />
                                        <p className="text-sm text-zinc-500">Los reels se sincronizan automáticamente via n8n</p>
                                        <p className="text-xs text-zinc-600 mt-1">Cuando estén disponibles aparecerán aquí</p>
                                    </div>
                                ) : (() => {
                                    const totalV = reels.reduce((s, r) => s + (r.views || 0), 0)
                                    const avgV = reels.length > 0 ? totalV / reels.length : 1
                                    return reels.map((reel) => {
                                        const multiplier = avgV > 0 ? reel.views / avgV : 0
                                        const reelUrl = reel.video_url ?? undefined
                                        return (
                                            <div
                                                key={reel.id}
                                                className="group rounded-xl border border-white/[0.06] bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] overflow-hidden hover:border-white/[0.1] hover:bg-white/[0.04] transition-all duration-300 flex flex-col"
                                            >
                                                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-t-xl bg-zinc-800">
                                                    <ReelThumbnail url={reel.thumbnail_url} />
                                                    <MultiplierBadge multiplier={multiplier} />
                                                    {(reel as CompetitorReel & { duration?: number | null }).duration != null && (
                                                        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                                                            {(() => {
                                                                const d = (reel as CompetitorReel & { duration?: number }).duration!
                                                                const m = Math.floor(d / 60)
                                                                const s = d % 60
                                                                return `${m}:${String(s).padStart(2, '0')}`
                                                            })()}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                                                    <p className="font-mono text-lg font-bold text-zinc-100 leading-none">
                                                        {formatNumber(reel.views)}
                                                    </p>
                                                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                                                        <span className="flex items-center gap-0.5">
                                                            <Heart className="h-3 w-3" />{formatNumber(reel.likes)}
                                                        </span>
                                                        <span className="flex items-center gap-0.5">
                                                            <MessageCircle className="h-3 w-3" />{formatNumber(reel.comments)}
                                                        </span>
                                                        <span className="flex items-center gap-0.5">
                                                            <Share2 className="h-3 w-3" />{formatNumber(reel.shares)}
                                                        </span>
                                                        <span className="flex items-center gap-0.5">
                                                            <Bookmark className="h-3 w-3" />{formatNumber(reel.saves)}
                                                        </span>
                                                    </div>
                                                    {reel.caption && (
                                                        <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                                            {reel.caption}
                                                        </p>
                                                    )}
                                                    {reelUrl && (
                                                        <a
                                                            href={reelUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="mt-auto flex items-center justify-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                                                        >
                                                            <ExternalLink className="h-3 w-3" />
                                                            Ver en IG
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })
                                })()}
                            </div>
                        </div>

                        {/* Right: sticky analysis sidebar (1/3) */}
                        <div className="flex-1 min-w-0 sticky top-8 space-y-4">
                            <AnalysisField
                                label="Oferta"
                                field="oferta"
                                competitorId={competitor.id}
                                initialValue={competitor.oferta}
                            />
                            <AnalysisField
                                label="Avatar"
                                field="avatar_target"
                                competitorId={competitor.id}
                                initialValue={competitor.avatar_target}
                            />
                            <AnalysisField
                                label="Conclusión"
                                field="conclusion"
                                competitorId={competitor.id}
                                initialValue={competitor.conclusion}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ClientCompetitors({ competitors, competitorReels, clientId }: Props) {
    const [showForm, setShowForm] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    function toggleExpand(id: string) {
        setExpandedId((prev) => (prev === id ? null : id))
    }

    return (
        <div className="space-y-4">
            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-400">
                    {competitors.length} competidor{competitors.length !== 1 ? 'es' : ''} registrado{competitors.length !== 1 ? 's' : ''}
                </p>
                <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Nuevo Competidor
                </Button>
            </div>

            {/* ── Empty state ── */}
            {competitors.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-16 text-center">
                    <Users className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500">Sin competidores registrados</p>
                    <p className="text-xs text-zinc-600 mt-1">
                        Agregá competidores para trackear su contenido y estrategia
                    </p>
                    <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Agregar Competidor
                    </Button>
                </div>
            ) : (
                /* ── Competitor list ── */
                <div className="space-y-3">
                    {competitors.map((competitor) => (
                        <CompetitorCard
                            key={competitor.id}
                            competitor={competitor}
                            reels={competitorReels[competitor.id] || []}
                            clientId={clientId}
                            isExpanded={expandedId === competitor.id}
                            onToggle={() => toggleExpand(competitor.id)}
                        />
                    ))}
                </div>
            )}

            {/* ── Modal ── */}
            {showForm && (
                <NuevoCompetidorForm
                    clientId={clientId}
                    onClose={() => setShowForm(false)}
                />
            )}
        </div>
    )
}
