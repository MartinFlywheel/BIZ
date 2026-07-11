'use client'

import { formatCurrency, formatDate } from '@/lib/utils'
import { TrendingDown } from 'lucide-react'
import type { FunnelResult, FunnelStage } from '@/lib/types'

// ── Layout ────────────────────────────────────────────────────────────────────

const SEG_H = 92    // px height per segment
const GAP   = 3     // px gap between segments
const MIN_W = 22    // % narrowest at bottom

// ── Helpers ───────────────────────────────────────────────────────────────────

function segFill(stage: FunnelStage): string {
  if (stage.is_bottleneck) return '#b91c1c'
  switch (stage.status) {
    case 'critical': return '#7f1d1d'
    case 'warning':  return '#7c2d12'
    default:         return '#1a1a28'
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

      {/* Header */}
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

      {/* Funnel card */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5 pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-5">
          Embudo de ventas
        </p>

        <div className="flex items-stretch gap-6">

          {/* ── Left: visual funnel trapezoids ── */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: `${GAP}px` }}>
            {stages.map((stage, i) => {
              const topW = 100 - (i / n) * (100 - MIN_W)
              const botW = 100 - ((i + 1) / n) * (100 - MIN_W)
              const ti   = (100 - topW) / 2
              const bi   = (100 - botW) / 2

              return (
                <div
                  key={stage.id}
                  style={{
                    height: SEG_H,
                    filter: stage.is_bottleneck
                      ? 'drop-shadow(0 0 22px rgba(220,38,38,0.45))'
                      : undefined,
                  }}
                >
                  <div
                    className="w-full h-full flex flex-col items-center justify-center select-none"
                    style={{
                      clipPath: `polygon(${ti}% 0%, ${100 - ti}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`,
                      background: segFill(stage),
                    }}
                  >
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] leading-none"
                      style={{ color: 'rgba(255,255,255,0.45)' }}
                    >
                      {stage.label}
                    </span>
                    <span
                      className="font-mono text-[2rem] font-bold leading-tight mt-1"
                      style={{ color: 'rgba(255,255,255,0.92)' }}
                    >
                      {typeof stage.value === 'number'
                        ? stage.value.toLocaleString()
                        : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Right: conversion rates aligned to segments ── */}
          <div
            className="w-44 shrink-0 flex flex-col border-l border-white/[0.05]"
            style={{ gap: `${GAP}px` }}
          >
            {stages.map((stage, i) => (
              <div
                key={stage.id}
                className="flex flex-col justify-center pl-4"
                style={{ height: SEG_H }}
              >
                {/* Skip first segment — it's the funnel entry, no "conversion from above" */}
                {i > 0 && stage.benchmark_min > 0 ? (
                  <div className="space-y-[3px]">
                    <p className="text-[10px] text-zinc-500 leading-tight">
                      Tasa de {stage.label.toLowerCase()}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-[7px] w-[7px] rounded-full shrink-0"
                        style={{ background: dotColor(stage) }}
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
                  <p className="text-[10px] text-zinc-700 italic">Entrada del funnel</p>
                ) : null}
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Money cards */}
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
