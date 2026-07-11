'use client'

import { formatCurrency, formatDate } from '@/lib/utils'
import { TrendingDown } from 'lucide-react'
import type { FunnelResult, FunnelStage } from '@/lib/types'

// ── Layout ────────────────────────────────────────────────────────────────────

const SEG_H = 88    // px per segment
const GAP   = 2     // px between segments
const MIN_W = 22    // % narrowest (bottom)

// ── Color helpers ─────────────────────────────────────────────────────────────

function segFill(stage: FunnelStage, i: number): string {
  // First stage (Vistas) is dark blue-black to contrast with the red funnel
  if (i === 0) return '#0f0f1a'
  if (stage.is_bottleneck) return '#c41a1a'
  switch (stage.status) {
    case 'critical': return '#8b1e1e'
    case 'warning':  return '#854020'
    default:         return '#1d1d2e'
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

      {/* ── Dramatic background container ── */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ background: '#080510' }}
      >
        {/* Ambient red orbs — behind everything */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Top-right large orb */}
          <div
            className="absolute -top-24 -right-24 w-80 h-80 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(200,30,30,0.38) 0%, transparent 68%)',
              filter: 'blur(8px)',
            }}
          />
          {/* Center-left mid orb */}
          <div
            className="absolute top-1/3 -left-20 w-56 h-56 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(170,20,20,0.28) 0%, transparent 70%)',
              filter: 'blur(6px)',
            }}
          />
          {/* Bottom-center glow */}
          <div
            className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-48 rounded-full"
            style={{
              background: 'radial-gradient(ellipse, rgba(185,28,28,0.22) 0%, transparent 70%)',
              filter: 'blur(12px)',
            }}
          />
          {/* Subtle top-center highlight */}
          <div
            className="absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full"
            style={{
              background: 'radial-gradient(ellipse, rgba(220,50,50,0.12) 0%, transparent 70%)',
            }}
          />
        </div>

        {/* ── Glass card ── */}
        <div
          className="relative m-3 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(10, 6, 18, 0.52)',
            backdropFilter: 'blur(22px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: [
              '0 2px 48px rgba(0,0,0,0.55)',
              'inset 0 1px 0 rgba(255,255,255,0.08)',
              '0 0 80px rgba(180,20,20,0.1)',
            ].join(', '),
          }}
        >
          {/* Glass top-edge highlight */}
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.14) 60%, transparent 95%)',
            }}
          />

          <div className="p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-5"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              Embudo de ventas
            </p>

            <div className="flex items-stretch gap-6">

              {/* ── Funnel segments ── */}
              <div
                className="flex-1 min-w-0 flex flex-col"
                style={{
                  gap: `${GAP}px`,
                  filter: 'drop-shadow(0 12px 40px rgba(180,20,20,0.22))',
                }}
              >
                {stages.map((stage, i) => {
                  const topW = 100 - (i / n) * (100 - MIN_W)
                  const botW = 100 - ((i + 1) / n) * (100 - MIN_W)
                  const ti   = (100 - topW) / 2
                  const bi   = (100 - botW) / 2
                  const fill = segFill(stage, i)

                  return (
                    <div
                      key={stage.id}
                      className="relative"
                      style={{
                        height: SEG_H,
                        filter: stage.is_bottleneck
                          ? 'drop-shadow(0 0 28px rgba(220,38,38,0.5))'
                          : undefined,
                      }}
                    >
                      {/* Trapezoid base */}
                      <div
                        className="absolute inset-0"
                        style={{
                          clipPath: `polygon(${ti}% 0%, ${100 - ti}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`,
                          background: fill,
                        }}
                      />
                      {/* Glass sheen — white highlight at top of each segment */}
                      <div
                        className="absolute inset-0"
                        style={{
                          clipPath: `polygon(${ti}% 0%, ${100 - ti}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`,
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.01) 35%, transparent 60%)',
                          pointerEvents: 'none',
                        }}
                      />
                      {/* Subtle bottom edge line (glass panel separator) */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-px"
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          clipPath: `polygon(${bi}% 0%, ${100 - bi}% 0%, ${100 - bi}% 100%, ${bi}% 100%)`,
                        }}
                      />
                      {/* Text content */}
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
                              ? '0 0 20px rgba(255,100,100,0.5)'
                              : '0 1px 8px rgba(0,0,0,0.6)',
                          }}
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

              {/* ── Right panel: conversion rates ── */}
              <div
                className="w-44 shrink-0 flex flex-col rounded-lg"
                style={{
                  gap: `${GAP}px`,
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.05)',
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
                        <p
                          className="text-[10px] leading-tight"
                          style={{ color: 'rgba(255,255,255,0.35)' }}
                        >
                          Tasa de {stage.label.toLowerCase()}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-[7px] w-[7px] rounded-full shrink-0"
                            style={{
                              background: dotColor(stage),
                              boxShadow: `0 0 6px ${dotColor(stage)}`,
                            }}
                          />
                          <span className={`font-mono text-xl font-bold leading-none ${rateCls(stage)}`}>
                            {stage.rate.toFixed(1)}%
                          </span>
                        </div>
                        <p className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {(-(100 - stage.rate)).toFixed(0)}% drop
                        </p>
                        <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.18)' }}>
                          bench {stage.benchmark_min}–{stage.benchmark_max}%
                        </p>
                      </div>
                    ) : i === 0 ? (
                      <p
                        className="text-[10px] italic"
                        style={{ color: 'rgba(255,255,255,0.2)' }}
                      >
                        Entrada del funnel
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Money cards — also glass style ── */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Facturación',    value: formatCurrency(raw.facturacion),    cls: 'text-white' },
          { label: 'Cash Collected', value: formatCurrency(raw.cash_collected), cls: 'text-emerald-300' },
        ].map(card => (
          <div
            key={card.label}
            className="rounded-xl p-4 relative overflow-hidden"
            style={{
              background: 'rgba(12, 8, 22, 0.6)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            {/* Subtle top highlight */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }}
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
