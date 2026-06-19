'use client'

import { Card } from '@/components/ui/card'
import { cn, formatNumber, formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, TrendingDown } from 'lucide-react'
import type { FunnelResult } from '@/lib/types'


interface Props {
    funnel: FunnelResult
    clientName: string
}

/**
 * FunnelView — detailed per-stage funnel for a single client.
 * Reads the latest weekly snapshot via calculateFunnel. Each stage shows its
 * retention rate vs. benchmark and highlights the single worst bottleneck.
 */
export function FunnelView({ funnel, clientName }: Props) {
    const { stages, bottleneck, bottleneck_drop, period, raw } = funnel

    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight text-white/90">
                        Funnel — {clientName}
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500">
                        {period.type} · {formatDate(period.start)} — {formatDate(period.end)}
                    </p>
                </div>
                {bottleneck && (
                    <div className="flex items-center gap-2 rounded-lg border border-[#ff453a]/25 bg-[#ff453a]/[0.06] px-3 py-1.5">
                        <TrendingDown className="h-3.5 w-3.5 text-[#ff453a]" />
                        <span className="text-xs text-red-300/90">
                            Cuello de botella: <span className="font-medium">{stages.find((s) => s.id === bottleneck)?.label}</span>
                            {' '}(−{bottleneck_drop} pts)
                        </span>
                    </div>
                )}
            </div>

            {/* Raw volume row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <RawStat label="Views Reel" value={formatNumber(raw.views_reels)} />
                <RawStat label="Views Historia" value={formatNumber(raw.views_historias)} />
                <RawStat label="Chats" value={formatNumber(raw.chats_abiertos)} />
                <RawStat label="Conv." value={formatNumber(raw.conversaciones)} />
                <RawStat label="Agendas" value={formatNumber(raw.agendas)} />
                <RawStat label="Shows" value={formatNumber(raw.shows)} />
                <RawStat label="Cierres" value={formatNumber(raw.cierres)} />
            </div>

            {/* Stage breakdown */}
            <Card className="space-y-1 p-0">
                {stages.map((stage, i) => {
                    const isCritical = stage.status === 'critical'
                    const isBottleneck = stage.is_bottleneck
                    // Visual bar relative to the benchmark_max (clamped to 100%)
                    const pct = Math.min((stage.rate / Math.max(stage.benchmark_max, 1)) * 100, 100)
                    return (
                        <div
                            key={stage.id}
                            className={cn(
                                'flex flex-col gap-2 px-5 py-4',
                                i !== stages.length - 1 && 'border-b border-white/[0.05]',
                                isBottleneck && 'bg-[#ff453a]/[0.05]'
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-white/90">{stage.label}</span>
                                    {isBottleneck && (
                                        <span className="inline-flex items-center gap-1 rounded-md border border-[#ff453a]/30 bg-[#ff453a]/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                                            <AlertTriangle className="h-2.5 w-2.5" /> Cuello de botella
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-baseline gap-2 font-mono">
                                    <span className={cn('text-lg font-semibold', isCritical ? 'text-red-300' : 'text-white')}>
                                        {stage.rate}%
                                    </span>
                                    <span className="text-xs text-zinc-600">
                                        {stage.benchmark_min}–{stage.benchmark_max}%
                                    </span>
                                </div>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all duration-500',
                                        isCritical
                                            ? 'bg-[#ff453a] shadow-[0_0_8px_rgba(255,69,58,0.5)]'
                                            : 'bg-emerald-400'
                                    )}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    )
                })}
            </Card>

            {/* Money row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Card>
                    <p className="text-sm font-medium text-zinc-400">Facturación</p>
                    <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-white">
                        {formatCurrency(raw.facturacion)}
                    </p>
                </Card>
                <Card>
                    <p className="text-sm font-medium text-zinc-400">Cash Collected</p>
                    <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-emerald-300">
                        {formatCurrency(raw.cash_collected)}
                    </p>
                </Card>
            </div>
        </div>
    )
}

function RawStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="mt-0.5 font-mono text-base font-semibold text-white/90">{value}</p>
        </div>
    )
}
