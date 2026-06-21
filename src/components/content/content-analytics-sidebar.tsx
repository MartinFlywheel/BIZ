'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { TrendingUp, DollarSign, Eye } from 'lucide-react'
import type { ContentAnalytics } from '@/lib/actions/content-analytics'

interface Props {
    analytics: ContentAnalytics
}

// ── Donut chart colors ────────────────────────────────────────────────────────
const DONUT_COLORS = ['#ff453a', '#a855f7', '#3b82f6']

// ── Glass card wrapper ────────────────────────────────────────────────────────
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={`rounded-2xl border border-white/[0.06] p-4 relative overflow-hidden ${className}`}
            style={{
                background: 'linear-gradient(145deg, rgba(255,69,58,0.06) 0%, rgba(0,0,0,0.55) 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05)',
            }}
        >
            {/* ambient glow */}
            <div className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-red-600/10 blur-2xl" />
            <div className="relative z-10">{children}</div>
        </div>
    )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div className="flex items-center gap-1.5 mb-3">
            {icon}
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-red-400/70">{label}</p>
        </div>
    )
}

// ── Engagement donut ──────────────────────────────────────────────────────────
function EngagementWidget({ analytics }: { analytics: ContentAnalytics }) {
    const { engagement } = analytics
    const donutData = [
        { name: 'Likes', value: engagement.total_likes },
        { name: 'Guardados', value: engagement.total_saves },
        { name: 'Comentarios', value: engagement.total_comments },
    ].filter((d) => d.value > 0)

    const hasData = donutData.length > 0

    return (
        <GlassCard>
            <SectionLabel icon={<TrendingUp className="h-3 w-3 text-red-400/60" />} label="Engagement" />

            <div className="flex items-center gap-3">
                {/* Donut */}
                <div className="flex-shrink-0 w-20 h-20">
                    {hasData ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={donutData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={22}
                                    outerRadius={36}
                                    paddingAngle={2}
                                    dataKey="value"
                                    strokeWidth={0}
                                >
                                    {donutData.map((_, i) => (
                                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: '#0a0a0a',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: '8px',
                                        fontSize: '11px',
                                        color: '#d4d4d8',
                                    }}
                                    formatter={(v) => formatNumber(Number(v ?? 0))}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="w-full h-full rounded-full border border-white/[0.06] flex items-center justify-center">
                            <span className="text-[10px] text-zinc-600">—</span>
                        </div>
                    )}
                </div>

                {/* Legend */}
                <div className="flex-1 space-y-1.5">
                    {[
                        { label: 'Likes', value: engagement.total_likes, color: DONUT_COLORS[0] },
                        { label: 'Guardados', value: engagement.total_saves, color: DONUT_COLORS[1] },
                        { label: 'Comentarios', value: engagement.total_comments, color: DONUT_COLORS[2] },
                    ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                                <span className="text-[11px] text-zinc-500">{item.label}</span>
                            </div>
                            <span className="text-[11px] font-mono text-zinc-300">{formatNumber(item.value)}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Engagement rate */}
            <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-baseline justify-between">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Eng. Rate</span>
                <span className="text-2xl font-mono font-bold text-zinc-100">
                    {engagement.engagement_rate.toFixed(1)}
                    <span className="text-sm text-zinc-500 ml-0.5">%</span>
                </span>
            </div>
            <p className="text-[10px] text-zinc-700 mt-0.5">likes + saves + cmts / views</p>
        </GlassCard>
    )
}

// ── Ranked list row ───────────────────────────────────────────────────────────
function RankedRow({
    rank,
    label,
    value,
    valueLabel,
    maxValue,
    barColor,
}: {
    rank: number
    label: string
    value: number
    valueLabel: string
    maxValue: number
    barColor: string
}) {
    const pct = maxValue > 0 ? (value / maxValue) * 100 : 0

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600 w-3 flex-shrink-0">{rank}</span>
                <span className="flex-1 text-[11px] text-zinc-300 truncate leading-tight">{label}</span>
                <span className="text-[11px] font-mono font-semibold text-emerald-400 flex-shrink-0">{valueLabel}</span>
            </div>
            <div className="ml-5 h-0.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: barColor }}
                />
            </div>
        </div>
    )
}

// ── Top Ventas ────────────────────────────────────────────────────────────────
function TopVentasWidget({ analytics }: { analytics: ContentAnalytics }) {
    const { top_by_revenue, total_revenue } = analytics
    const maxRevenue = top_by_revenue[0]?.revenue ?? 0

    return (
        <GlassCard>
            <div className="flex items-center justify-between mb-1">
                <SectionLabel icon={<DollarSign className="h-3 w-3 text-red-400/60" />} label="Top Ventas" />
                {total_revenue > 0 && (
                    <span className="text-[10px] font-mono text-emerald-500 -mt-3">{formatCurrency(total_revenue)}</span>
                )}
            </div>

            {top_by_revenue.length === 0 ? (
                <p className="text-[11px] text-zinc-600 py-2">Sin datos de ventas aún</p>
            ) : (
                <div className="space-y-3">
                    {top_by_revenue.map((item, i) => (
                        <RankedRow
                            key={item.content_id}
                            rank={i + 1}
                            label={item.caption || item.keyword_trigger || 'Sin título'}
                            value={item.revenue}
                            valueLabel={formatCurrency(item.revenue)}
                            maxValue={maxRevenue}
                            barColor="linear-gradient(90deg, #10b981, #34d399)"
                        />
                    ))}
                </div>
            )}
        </GlassCard>
    )
}

// ── Top por Views ─────────────────────────────────────────────────────────────
function TopViewsWidget({ analytics }: { analytics: ContentAnalytics }) {
    const { top_by_views } = analytics
    const maxViews = top_by_views[0]?.views ?? 0

    return (
        <GlassCard>
            <SectionLabel icon={<Eye className="h-3 w-3 text-red-400/60" />} label="Top por Views" />

            {top_by_views.length === 0 ? (
                <p className="text-[11px] text-zinc-600 py-2">Sin datos de views aún</p>
            ) : (
                <div className="space-y-3">
                    {top_by_views.map((item, i) => (
                        <RankedRow
                            key={item.content_id}
                            rank={i + 1}
                            label={item.caption || item.keyword_trigger || 'Sin título'}
                            value={item.views}
                            valueLabel={formatNumber(item.views)}
                            maxValue={maxViews}
                            barColor="linear-gradient(90deg, #6366f1, #818cf8)"
                        />
                    ))}
                </div>
            )}
        </GlassCard>
    )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────
export function ContentAnalyticsSidebar({ analytics }: Props) {
    return (
        <div className="space-y-3">
            <EngagementWidget analytics={analytics} />
            <TopVentasWidget analytics={analytics} />
            <TopViewsWidget analytics={analytics} />
        </div>
    )
}
