'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { upsertContentMetrics } from '@/lib/actions/content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import type { ContentPiece } from '@/lib/types'

interface ContentMetric {
    content_id: string
    chats_nuevos: number
    conversaciones: number
    agendas: number
    shows: number
    cierres: number
    ticket: number | null
    aov: number | null
    cash_collected: number | null
    manychat_label: string | null
    notas: string | null
}

interface Props {
    contentPiece: ContentPiece
    existingMetric?: ContentMetric | null
    onClose: () => void
}

export function ContentFunnelForm({ contentPiece, existingMetric, onClose }: Props) {
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
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al guardar métricas')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 overflow-y-auto py-8">
            <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-50">Métricas de Funnel</h2>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[340px]">
                            {contentPiece.caption || contentPiece.content_type} · {contentPiece.keyword_trigger || '—'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 mt-0.5">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Funnel Section */}
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                            Embudo de Conversión
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <Input
                                id="chats_nuevos"
                                name="chats_nuevos"
                                label="Chats Nuevos"
                                type="number"
                                min="0"
                                placeholder="0"
                                defaultValue={existingMetric?.chats_nuevos ?? ''}
                            />
                            <Input
                                id="conversaciones"
                                name="conversaciones"
                                label="Conversaciones"
                                type="number"
                                min="0"
                                placeholder="0"
                                defaultValue={existingMetric?.conversaciones ?? ''}
                            />
                            <Input
                                id="agendas"
                                name="agendas"
                                label="Agendas"
                                type="number"
                                min="0"
                                placeholder="0"
                                defaultValue={existingMetric?.agendas ?? ''}
                            />
                            <Input
                                id="shows"
                                name="shows"
                                label="Shows"
                                type="number"
                                min="0"
                                placeholder="0"
                                defaultValue={existingMetric?.shows ?? ''}
                            />
                            <Input
                                id="cierres"
                                name="cierres"
                                label="Cierres"
                                type="number"
                                min="0"
                                placeholder="0"
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
                                placeholder="0.00"
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
                        <label htmlFor="notas" className="block text-sm font-medium text-zinc-400">
                            Notas
                        </label>
                        <textarea
                            id="notas"
                            name="notas"
                            rows={3}
                            placeholder="Observaciones sobre el rendimiento de esta pieza..."
                            defaultValue={existingMetric?.notas ?? ''}
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
        </div>
    )
}
