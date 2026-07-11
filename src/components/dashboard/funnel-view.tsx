'use client'

import { formatCurrency, formatDate } from '@/lib/utils'
import { TrendingDown } from 'lucide-react'
import type { FunnelResult, FunnelStage } from '@/lib/types'

// ── Layout ────────────────────────────────────────────────────────────────────

const SEG_H = 88
const GAP   = 2
const MIN_W = 22   // % narrowest at bottom

// ── Helpers ───────────────────────────────────────────────────────────────────

function segFill(stage: FunnelStage, i: number): string {
  if (i === 0) return '#12121e'
  if (stage.is_bottleneck) return '#c41a1a'
  switch (stage.status) {
    case 'critical': return '#8b1e1e'
    case 'warning':  return '#854020'
    default:         return '#1e1e30'
  }
}

function dotColor(stage: FunnelStage): string {
  if (stage.status === 'healthy') return '#34d399'
  if (stage.status === 'warning') return '#fbbf24'
  return '#f87171'
}

function rateCls(stage: FunnelStage): string {
  if (stage.status === 'healthy') return 'text-emerald-400'
  if (stage.status === 'warning') return 'text-amber-400'
  return 'text-red-400'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  funnel: FunnelResult
  clientName: string
}

export function FunnelView({ funnel, clientName }: Props) {
  const { stages, bottleneck, bottleneck_drop, period, raw } = funnel
  const n = stages.length

  return (
    <div className="space-y-5">

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

      {/* ── Funnel card — integrates with page background ── */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.022)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: [
            '0 1px 0 rgba(255,255,255,0.05) inset',     // top edge glass highlight
            '0 -1px 0 rgba(0,0,0,0.4) inset',           // bottom inner shadow
            '0 8px 40px rgba(0,0,0,0.45)',               // outer elevation
            '0 0 0 1px rgba(0,0,0,0.25)',               // outer subtle outline
          ].join(', '),
        }}
      >
        {/* Ambient red glow — top-right corner, stays inside card */}
        <div
          className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(185,28,28,0.13) 0%, transparent 68%)',
          }}
        />
        {/* Ambient red glow — bottom center */}
        <div
          className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse, rgba(160,20,20,0.1) 0%, transparent 70%)',
          }}
        />

        {/* Top-edge glass reflection line */}
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.1) 35%, rgba(255,255,255,0.1) 65%, transparent 95%)',
          }}
        />

        <div className="relative p-5">
          <p
            className="text-[10px] font-semibold uppercase tracking-widest mb-5"
            style={{ color: 'rgba(255,255,255,0.28)' }}
          >
            Embudo de ventas
          </p>

          <div className="flex items-stretch gap-6">

            {/* ── Visual funnel ── */}
            <div
              className="flex-1 min-w-0 flex flex-col"
              style={{
                gap: `${GAP}px`,
                filter: 'drop-shadow(0 16px 48px rgba(160,20,20,0.25))',
              }}
            >
              {stages.map((stage, i) => {
                const topW = 100 - (i / n) * (100 - MIN_W)
                const botW = 100 - ((i + 1) / n) * (100 - MIN_W)
                const ti   = (100 - topW) / 2
                const bi   = (100 - botW) / 2
                const fill = segFill(stage, i)
                const clip = `polygon(${ti}% 0%, ${100 - ti}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`

                return (
                  <div
                    key={stage.id}
                    className="relative"
                    style={{
                      height: SEG_H,
                      filter: stage.is_bottleneck
                        ? 'drop-shadow(0 0 26px rgba(220,38,38,0.48))'
                        : undefined,
                    }}
                  >
                    {/* Base segment color */}
                    <div className="absolute inset-0" style={{ clipPath: clip, background: fill }} />

                    {/* Glass sheen — top highlight */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        clipPath: clip,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.01) 30%, transparent 55%)',
                      }}
                    />

                    {/* Glass sheen — left edge shimmer (catches the "light") */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        clipPath: clip,
                        background: 'linear-gradient(105deg, rgba(255,255,255,0.04) 0%, transparent 40%)',
                      }}
                    />

                    {/* Bottom separator line */}
                    <div
                      className="absolute bottom-0 inset-x-0 h-px pointer-events-none"
                      style={{
                        clipPath: `polygon(${bi}% 0%, ${100 - bi}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`,
                        background: 'rgba(255,255,255,0.055)',
                      }}
                    />

                    {/* Label + number */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.18em] leading-none"
                        style={{ color: 'rgba(255,255,255,0.42)' }}
                      >
                        {stage.label}
                      </span>
                      <span
                        className="font-mono text-[2rem] font-bold leading-tight mt-1"
                        style={{
                          color: 'rgba(255,255,255,0.93)',
                          textShadow: stage.is_bottleneck
                            ? '0 0 24px rgba(255,80,80,0.55)'
                            : '0 2px 10px rgba(0,0,0,0.7)',
                        }}
                      >
                        {typeof stage.value === 'number' ? stage.value.toLocaleString() : '—'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Rate panel ── */}
            <div
              className="w-44 shrink-0 flex flex-col rounded-lg"
              style={{
                gap: `${GAP}px`,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                padding: '4px 0',
              }}
            >
              {stages.map((stage, i) => (
                <div
                  key={stage.id}
                  className="flex flex-col justify-center px-4"
                  style={{ height: SEG_H }}
                >
                  {i > 0 && stage.benchmark_min > 0 ? (
                    <div className="space-y-[3px]">
                      <p className="text-[10px] leading-tight text-zinc-500">
                        Tasa de {stage.label.toLowerCase()}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-[7px] w-[7px] rounded-full shrink-0"
                          style={{
                            background: dotColor(stage),
                            boxShadow: `0 0 7px ${dotColor(stage)}88`,
                          }}
                        />
                        <span className={`font-mono text-xl font-bold leading-none ${rateCls(stage)}`}>
                          {stage.rate.toFixed(1)}%
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-zinc-600">
                        {(-(100 - stage.rate)).toFixed(0)}% drop
                      </p>
                      <p className="text-[10px] text-zinc-700">
                        bench {stage.benchmark_min}–{stage.benchmark_max}%
                      </p>
                    </div>
                  ) : i === 0 ? (
                    <p className="text-[10px] italic text-zinc-700">Entrada del funnel</p>
                  ) : null}
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

      {/* ── Money cards ── */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Facturación',    value: formatCurrency(raw.facturacion),    cls: 'text-white' },
          { label: 'Cash Collected', value: formatCurrency(raw.cash_collected), cls: 'text-emerald-300' },
        ].map(card => (
          <div
            key={card.label}
            className="relative rounded-xl p-4 overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.022)',
              border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 20px rgba(0,0,0,0.3)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)' }}
            />
            <p className="text-sm font-medium text-zinc-400">{card.label}</p>
            <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${card.cls}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

    </div>
  )
}
