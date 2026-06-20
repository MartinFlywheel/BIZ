'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { createCallAction } from '@/lib/actions/calls'
import { formatDate } from '@/lib/utils'
import { ExternalLink, Clock, Mic, Plus, X, Phone } from 'lucide-react'
import type { SalesCall, Lead } from '@/lib/types'

interface Props {
    calls: SalesCall[]
    leads: Lead[]
}

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

export function ClientCallsList({ calls, leads }: Props) {
    const [showForm, setShowForm] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    const leadsMap = new Map<string, Lead>()
    for (const l of leads) leadsMap.set(l.id, l)

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const formData = new FormData(e.currentTarget)
            await createCallAction(formData)
            router.refresh()
            setShowForm(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al registrar')
        } finally {
            setLoading(false)
        }
    }

    const sorted = [...calls].sort((a, b) => {
        const da = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0
        const db = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0
        return db - da
    })

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-400">
                    {calls.length} llamada{calls.length !== 1 ? 's' : ''} registrada{calls.length !== 1 ? 's' : ''}
                </p>
                <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Registrar Llamada
                </Button>
            </div>

            {calls.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Mic className="h-8 w-8 text-zinc-700 mb-3" />
                    <p className="text-sm text-zinc-500">Sin llamadas registradas</p>
                    <p className="text-xs text-zinc-600 mt-1">Registrá la primera llamada para empezar el tracking</p>
                </div>
            ) : (
                <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_140px_100px_80px_80px_40px] gap-4 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                        <span>Lead</span>
                        <span>Fecha</span>
                        <span>Estado</span>
                        <span>Duración</span>
                        <span>Sentimiento</span>
                        <span />
                    </div>
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
                                    <div>
                                        <p className="text-sm font-medium text-zinc-100 truncate">{leadName}</p>
                                        {call.ai_summary && (
                                            <p className="text-[11px] text-zinc-600 truncate mt-0.5">{call.ai_summary}</p>
                                        )}
                                    </div>
                                    <div className="text-sm text-zinc-400">
                                        {call.scheduled_at ? formatDate(call.scheduled_at) : '—'}
                                    </div>
                                    <div>
                                        {outcomeCfg ? (
                                            <Badge variant={outcomeCfg.variant}>{outcomeCfg.label}</Badge>
                                        ) : (
                                            <span className="text-sm text-zinc-600">—</span>
                                        )}
                                    </div>
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
            )}

            {showForm && (
                <Modal onClose={() => setShowForm(false)} size="md">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-50 flex items-center gap-2">
                                <Phone className="h-4 w-4" /> Registrar Llamada
                            </h2>
                            <p className="text-xs text-zinc-500 mt-0.5">Vinculá esta llamada a un lead existente</p>
                        </div>
                        <button onClick={() => setShowForm(false)} className="text-zinc-400 hover:text-zinc-200">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Select
                            id="lead_id"
                            name="lead_id"
                            label="Lead *"
                            options={leads.map((l) => ({
                                value: l.id,
                                label: `${l.full_name || l.ig_username || 'Sin nombre'}${l.ig_username ? ` (@${l.ig_username})` : ''}`,
                            }))}
                            placeholder="Seleccionar lead..."
                            required
                        />
                        <Input
                            id="scheduled_at"
                            name="scheduled_at"
                            label="Fecha de la llamada"
                            type="datetime-local"
                        />
                        <Select
                            id="outcome"
                            name="outcome"
                            label="Resultado"
                            placeholder="Seleccionar..."
                            options={[
                                { value: 'completed', label: 'Completada' },
                                { value: 'no_show', label: 'No Show' },
                                { value: 'rescheduled', label: 'Reagendada' },
                                { value: 'cancelled', label: 'Cancelada' },
                            ]}
                        />
                        <Input
                            id="fathom_call_url"
                            name="fathom_call_url"
                            label="Fathom URL"
                            type="url"
                            placeholder="https://fathom.video/..."
                        />
                        <Select
                            id="sentiment"
                            name="sentiment"
                            label="Sentimiento"
                            placeholder="Sin evaluar"
                            options={[
                                { value: 'positive', label: 'Positivo' },
                                { value: 'neutral', label: 'Neutral' },
                                { value: 'negative', label: 'Negativo' },
                            ]}
                        />
                        <div className="space-y-1.5">
                            <label htmlFor="ai_summary" className="block text-sm font-medium text-zinc-400">
                                Notas / Resumen
                            </label>
                            <textarea
                                id="ai_summary"
                                name="ai_summary"
                                rows={3}
                                placeholder="Resumen de la llamada, objeciones, próximos pasos..."
                                className="flex w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-none"
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3 pt-1">
                            <Button type="button" variant="secondary" onClick={() => setShowForm(false)} className="flex-1">
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading} className="flex-1">
                                {loading ? 'Guardando...' : 'Registrar'}
                            </Button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    )
}
