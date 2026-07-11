'use client'

import { useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react'
import type { ClientHealthAlert } from '@/lib/types'


interface Props {
    alerts: ClientHealthAlert[]
    selectedId?: string
}

export function HealthAlerts({ alerts, selectedId }: Props) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [isPending, startTransition] = useTransition()

    function select(clientId: string) {
        const params = new URLSearchParams(searchParams.toString())
        if (selectedId === clientId) {
            params.delete('client')
        } else {
            params.set('client', clientId)
        }
        // startTransition keeps the current UI visible (no blank) while the
        // server streams the new ClientDetail section behind the skeleton
        startTransition(() => {
            router.push(`/dashboard?${params.toString()}`)
        })
    }

    if (alerts.length === 0) {
        return (
            <Card>
                <div className="flex h-32 items-center justify-center text-sm text-zinc-500">
                    No hay clientes activos con métricas cargadas todavía
                </div>
            </Card>
        )
    }

    const critical = alerts.filter((a) => a.status === 'critical')
    const healthy = alerts.filter((a) => a.status === 'healthy')

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-white/90">Salud de Clientes</h2>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#ff453a] shadow-[0_0_8px_rgba(255,69,58,0.7)]" />
                        {critical.length} con cuellos de botella
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        {healthy.length} sanos
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...critical, ...healthy].map((client) => {
                    const isSelected = selectedId === client.client_id
                    const isCritical = client.status === 'critical'
                    return (
                        <button
                            key={client.client_id}
                            onClick={() => select(client.client_id)}
                            disabled={isPending}
                            className={cn(
                                'group flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all duration-200 hover:border-white/[0.1] hover:bg-white/[0.04]',
                                isSelected && 'border-[#ff453a]/40 bg-[#ff453a]/[0.06]',
                                isCritical && !isSelected && 'border-[#ff453a]/20 bg-[#ff453a]/[0.04]',
                                isPending && 'opacity-60 cursor-wait',
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-white/90">
                                        {client.client_name}
                                    </p>
                                    <p className="truncate text-xs text-zinc-500">{client.ig_handle}</p>
                                </div>
                                {isCritical ? (
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-[#ff453a]" />
                                ) : (
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                )}
                            </div>

                            {client.alerts.length > 0 ? (
                                <div className="mt-3 space-y-1.5">
                                    {client.alerts.slice(0, 2).map((a) => (
                                        <div key={a.stage_id} className="flex items-center justify-between text-xs">
                                            <span className="text-red-300/80">{a.stage_label}</span>
                                            <span className="font-mono text-red-300">
                                                {a.current_rate}% <span className="text-zinc-600">/ {a.benchmark_min}%</span>
                                            </span>
                                        </div>
                                    ))}
                                    {client.alerts.length > 2 && (
                                        <p className="text-xs text-zinc-600">+{client.alerts.length - 2} más</p>
                                    )}
                                </div>
                            ) : (
                                <p className="mt-3 text-xs text-emerald-400/80">Funnel dentro de benchmarks</p>
                            )}

                            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors group-hover:text-white/80">
                                {isPending && isSelected ? (
                                    <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Cargando…
                                    </>
                                ) : isSelected ? (
                                    <>Ocultar funnel <ChevronRight className="h-3 w-3" /></>
                                ) : (
                                    <>Ver funnel <ChevronRight className="h-3 w-3" /></>
                                )}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
