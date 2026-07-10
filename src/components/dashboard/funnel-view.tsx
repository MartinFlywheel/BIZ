'use client'

import { formatNumber, formatCurrency, formatDate } from '@/lib/utils'
import { AlertTriangle, TrendingDown } from 'lucide-react'
import type { FunnelResult, FunnelStage } from '@/lib/types'

// ── Color logic ───────────────────────────────────────────────────────────────

function stageStyle(stage: FunnelStage): { fill: string; textCls: string; glow: boolean } {
  if (stage.is_bottleneck) return { fill: '#dc2626', textCls: 'text-red-300',       glow: true  }
  switch (stage.status) {
    case 'critical': return  { fill: '#7f1d1d', textCls: 'text-red-400/80',         glow: false }
    case 'warning':  return  { fill: '#7c2d12', textCls: 'text-orange-400/70',      glow: false }
    default:         return  { fill: '#1e1e2a', textCls: 'text-zinc-400',           glow: false }
  }
}

// ── SVG dimensions ────────────────────────────────────────────────────────────

const SEG_H = 70   // height per segment in viewBox units
const GAP   = 4    // gap between segments
const VW    = 360  // viewBox width
const MAX_W = 360  // widest (top)
const MIN_W = 80   // narrowest (bottom)

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  funnel: FunnelResult
  clientName: string
}

export function FunnelView({ funnel, clientName }: Props) {
  const { stages, bottleneck, bottleneck_drop, period, raw } = funnel
  const n = stages.length
  const totalH = n * (SEG_H + GAP) - GAP

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
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
          <div className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-1.5">
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            <span className="text-xs text-red-300/90">
              Cuello de botella:{' '}
              <span className="font-medium">
                {stages.find((s) => s.id === bottleneck)?.label}
              </span>{' '}
              (−{bottleneck_drop} pts)
            </span>
          </div>
        )}
      </div>

      {/* ── Raw volume chips ── */}
      <div className="grid grid-cols-7 gap-2">
        {([
          ['Views Reel',     raw.views_reels],
          ['Views Historia', raw.views_historias],
          ['Chats',          raw.chats_abiertos],
          ['Conv.',          raw.conversaciones],
          ['Agendas',        raw.agendas],
          ['Shows',          raw.shows],
          ['Cierres',        raw.cierres],
        ] as [string, number][]).map(([label, val]) => (
          <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-white/90">{formatNumber(val)}</p>
          </div>
        ))}
      </div>

      {/* ── Visual funnel + labels ── */}
      <div className="flex items-start gap-5">

        {/* SVG funnel */}
        <div className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${VW} ${totalH}`}
            className="w-full"
            style={{ filter: 'drop-shadow(0 8px 48px rgba(185, 28, 28, 0.18))' }}
          >
            <defs>
              {/* Per-segment gradient (top slightly lighter than bottom) */}
              {stages.map((s, i) => {
                const { fill } = stageStyle(s)
                return (
                  <linearGradient key={s.id} id={`fg-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={fill} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={fill} stopOpacity={0.72} />
                  </linearGradient>
                )
              })}
              {/* Glow filter for bottleneck */}
              <filter id="fn-glow" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {stages.map((stage, i) => {
              const { glow } = stageStyle(stage)
              const topW = MAX_W - (i / n) * (MAX_W - MIN_W)
              const botW = MAX_W - ((i + 1) / n) * (MAX_W - MIN_W)
              const topL = (VW - topW) / 2
              const botL = (VW - botW) / 2
              const y1   = i * (SEG_H + GAP)
              const y2   = y1 + SEG_H
              const pts  = `${topL},${y1} ${topL + topW},${y1} ${botL + botW},${y2} ${botL},${y2}`

              return (
                <polygon
                  key={stage.id}
                  points={pts}
                  fill={`url(#fg-${i})`}
                  filter={glow ? 'url(#fn-glow)' : undefined}
                />
              )
            })}
          </svg>
        </div>

        {/* Stage labels — vertically aligned with SVG segments */}
        <div
          className="w-52 shrink-0 flex flex-col"
          style={{ gap: `${GAP}px` }}
        >
          {stages.map((stage) => {
            const { textCls } = stageStyle(stage)
            return (
              <div
                key={stage.id}
                className="flex flex-col justify-center"
                style={{ height: `${SEG_H}px` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-medium ${textCls}`}>{stage.label}</span>
                  {stage.is_bottleneck && (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5 font-mono mt-0.5">
                  <span className={`text-2xl font-bold leading-none ${textCls}`}>
                    {stage.rate}%
                  </span>
                  <span className="text-[11px] text-zinc-600">
                    {stage.benchmark_min}–{stage.benchmark_max}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>

      </div>

      {/* ── Money cards ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-sm font-medium text-zinc-400">Facturación</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-white">
            {formatCurrency(raw.facturacion)}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-sm font-medium text-zinc-400">Cash Collected</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-emerald-300">
            {formatCurrency(raw.cash_collected)}
          </p>
        </div>
      </div>

    </div>
  )
}
