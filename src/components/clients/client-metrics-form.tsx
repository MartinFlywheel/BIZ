'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { upsertClientMetrics } from '@/lib/actions/funnel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'

import { X } from 'lucide-react'

import type { ClientMetrics } from '@/lib/types'

interface Props {
    clientId: string
    metric?: ClientMetrics
    onClose: () => void
}

/** Default period = current ISO week (Mon–Sun) */
function defaultWeek() {
    const now = new Date()
    const day = (now.getDay() + 6) % 7 // 0 = Monday
    const monday = new Date(now)
    monday.setDate(now.getDate() - day)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    return { start: iso(monday), end: iso(sunday) }
}

export function ClientMetricsForm({ clientId, metric, onClose }: Props) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const week = defaultWeek()

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        const formData = new FormData(e.currentTarget)
        formData.set('client_id', clientId)
        formData.set('period_type', 'weekly')
        try {
            await upsertClientMetrics(formData)
            router.refresh()
            onClose()
        } catch {
            setError('Error al guardar las métricas')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal onClose={onClose} size="lg">
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-50">
                    {metric ? 'Editar Métricas Semanales' : 'Cargar Métricas Semanales'}
                </h2>
                <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

                <div className="grid grid-cols-2 gap-4">
                    <Input
                        id="period_start"
                        name="period_start"
                        label="Inicio de Semana"
                        type="date"
                        defaultValue={metric?.period_start || week.start}
                        required
                    />
                    <Input
                        id="period_end"
                        name="period_end"
                        label="Fin de Semana"
                        type="date"
                        defaultValue={metric?.period_end || week.end}
                        required
                    />
                </div>

                <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Volumen del Funnel
                    </p>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Input id="views_reels" name="views_reels" label="Views Reels" type="number" defaultValue={metric?.views_reels ?? ''} placeholder="0" />
                        <Input id="views_historias" name="views_historias" label="Views Historias" type="number" defaultValue={metric?.views_historias ?? ''} placeholder="0" />
                        <Input id="chats_abiertos" name="chats_abiertos" label="Chats Abiertos" type="number" defaultValue={metric?.chats_abiertos ?? ''} placeholder="0" />
                        <Input id="conversaciones" name="conversaciones" label="Conversaciones" type="number" defaultValue={metric?.conversaciones ?? ''} placeholder="0" />
                        <Input id="agendas" name="agendas" label="Agendas" type="number" defaultValue={metric?.agendas ?? ''} placeholder="0" />
                        <Input id="shows" name="shows" label="Shows" type="number" defaultValue={metric?.shows ?? ''} placeholder="0" />
                        <Input id="cierres" name="cierres" label="Cierres" type="number" defaultValue={metric?.cierres ?? ''} placeholder="0" />
                    </div>
                </div>

                <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Resultados
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <Input id="facturacion" name="facturacion" label="Facturación (USD)" type="number" step="0.01" defaultValue={metric?.facturacion ?? ''} placeholder="0" />
                        <Input id="cash_collected" name="cash_collected" label="Cash Collected (USD)" type="number" step="0.01" defaultValue={metric?.cash_collected ?? ''} placeholder="0" />
                    </div>
                </div>

                <Textarea
                    id="notes"
                    name="notes"
                    label="Notas Estratégicas / Ángulos de Contenido"
                    defaultValue={metric?.notes || ''}
                    rows={4}
                    placeholder="Ángulos que funcionaron, hipótesis para la próxima semana, observaciones del funnel..."
                />


                {error && <p className="text-sm text-red-400">{error}</p>}

                <div className="flex gap-3 pt-2">
                    <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
                    <Button type="submit" disabled={loading} className="flex-1">
                        {loading ? 'Guardando...' : 'Guardar Métricas'}
                    </Button>
                </div>
            </form>
        </Modal>
    )
}


