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
    Eye,
    Heart,
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

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {reels.map((reel) => (
                <div
                    key={reel.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden"
                >
                    {/* Thumbnail */}
                    <div className="relative aspect-[9/16] w-full bg-zinc-800 overflow-hidden rounded-t-xl">
                        {reel.thumbnail_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={reel.thumbnail_url}
                                alt={reel.caption || 'Reel'}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Reel</span>
                            </div>
                        )}
                    </div>

                    {/* Card body */}
                    <div className="p-2.5 space-y-1.5">
                        {reel.caption && (
                            <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight">
                                {reel.caption}
                            </p>
                        )}
                        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                            <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                <span className="font-mono">{formatNumber(reel.views)}</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <Heart className="h-3 w-3" />
                                <span className="font-mono">{formatNumber(reel.likes)}</span>
                            </span>
                        </div>
                    </div>
                </div>
            ))}
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

            {/* Expanded: full analysis + reels */}
            {isExpanded && (
                <div className="border-t border-zinc-800 px-4 pb-4 space-y-4">
                    {/* Full analysis */}
                    {competitor.analisis_estrategico && (
                        <div className="pt-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">
                                Análisis Estratégico
                            </p>
                            <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                                {competitor.analisis_estrategico}
                            </p>
                        </div>
                    )}

                    {/* Reels section */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-3">
                            Reels del Competidor
                        </p>
                        <CompetitorReelsGrid reels={reels} />
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
