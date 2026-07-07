'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Eye, MessageSquare, MessageCircle, BookOpen, DollarSign, TrendingUp, ArrowUpRight, ArrowDownRight, Minus, Calendar } from 'lucide-react'
import { getClientAnalyticsByPeriod, type ClientAnalyticsPeriod } from '@/lib/actions/client-analytics-period'
import { formatNumber, formatCurrency } from '@/lib/utils'

type Period = 7 | 15 | 30 | 90

const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: '7 días' },
  { value: 15, label: '15 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
]

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  pct,
  currency = false,
  accent = false,
}: {
  icon: React.ElementType
  label: string
  value: number
  pct?: number | null
  currency?: boolean
  accent?: boolean
}) {
  const positive = pct != null && pct > 0
  const negative = pct != null && pct < 0

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent ? 'text-emerald-400' : 'text-zinc-600'}`} />
      </div>
      <p className={`font-mono text-2xl font-bold leading-none ${accent ? 'text-emerald-400' : 'text-zinc-50'}`}>
        {currency ? formatCurrency(value) : formatNumber(value)}
      </p>
      {pct != null && (
        <div className={`flex items-center gap-1 text-[11px] font-mono ${positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-zinc-500'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : negative ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          <span>{positive ? '+' : ''}{pct}% vs anterior</span>
        </div>
      )}
      {pct == null && (
        <span className="text-[11px] text-zinc-700">Sin datos previos</span>
      )}
    </div>
  )
}

// ── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-white/[0.08] bg-zinc-950/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name}:</span>
          <span className="text-zinc-100 font-mono">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-2 animate-pulse">
      <div className="h-3 w-24 rounded bg-white/[0.06]" />
      <div className="h-7 w-32 rounded bg-white/[0.06]" />
      <div className="h-3 w-20 rounded bg-white/[0.06]" />
    </div>
  )
}

function SkeletonChart() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 animate-pulse">
      <div className="h-4 w-32 rounded bg-white/[0.06] mb-4" />
      <div className="h-48 rounded bg-white/[0.04]" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  clientId: string
}

export function ClientAnalyticsDashboard({ clientId }: Props) {
  const [period, setPeriod] = useState<Period>(90)
  const [data, setData] = useState<ClientAnalyticsPeriod | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const result = await getClientAnalyticsByPeriod(clientId, period)
      setData(result)
    })
  }, [clientId, period])

  const loading = isPending || !data

  return (
    <div className="space-y-5">
      {/* ── Period selector ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Calendar className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Período</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              disabled={isPending}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                period === p.value
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Cards ── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          {/* Row 1: content metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              icon={Eye}
              label="Vistas Totales"
              value={data.totals.views}
              pct={data.vs_prev.views}
            />
            <KpiCard
              icon={MessageSquare}
              label="Conversaciones"
              value={data.totals.chats_abiertos}
              pct={data.vs_prev.chats_abiertos}
            />
            <KpiCard
              icon={MessageCircle}
              label="Comentarios"
              value={data.totals.comments}
              pct={data.vs_prev.comments}
            />
            <KpiCard
              icon={BookOpen}
              label="Vistas de Historias"
              value={data.totals.views_historias}
              pct={null}
            />
          </div>

          {/* Row 2: business metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              icon={DollarSign}
              label="Facturación"
              value={data.totals.facturacion}
              pct={data.vs_prev.facturacion}
              currency
              accent
            />
            <KpiCard
              icon={TrendingUp}
              label="Efectivo Recolectado"
              value={data.totals.cash_collected}
              pct={data.vs_prev.cash_collected}
              currency
              accent
            />
            <KpiCard
              icon={TrendingUp}
              label="Cierres"
              value={data.totals.cierres}
              pct={null}
            />
          </div>
        </>
      )}

      {/* ── Charts ── */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Visibilidad: Alcance + Impresiones */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-4">
              Visibilidad
              <span className="ml-2 text-zinc-600 font-normal">Alcance · Impresiones</span>
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.time_series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gReach" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#52525b' }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(data.time_series.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#52525b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={6}
                  wrapperStyle={{ fontSize: 11, color: '#71717a' }}
                />
                <Area
                  type="monotone"
                  dataKey="reach"
                  name="Alcance"
                  stroke="#60a5fa"
                  strokeWidth={1.5}
                  fill="url(#gReach)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#60a5fa' }}
                />
                <Area
                  type="monotone"
                  dataKey="views"
                  name="Impresiones"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  fill="url(#gViews)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#a78bfa' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Interacciones: Likes + Guardados + Comentarios */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-4">
              Interacciones
              <span className="ml-2 text-zinc-600 font-normal">Me gusta · Guardados · Comentarios</span>
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.time_series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gLikes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff453a" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ff453a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSaves" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gComments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#52525b' }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(data.time_series.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#52525b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatNumber(v)}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={6}
                  wrapperStyle={{ fontSize: 11, color: '#71717a' }}
                />
                <Area
                  type="monotone"
                  dataKey="likes"
                  name="Me gusta"
                  stroke="#ff453a"
                  strokeWidth={1.5}
                  fill="url(#gLikes)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#ff453a' }}
                />
                <Area
                  type="monotone"
                  dataKey="saves"
                  name="Guardados"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  fill="url(#gSaves)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#34d399' }}
                />
                <Area
                  type="monotone"
                  dataKey="comments"
                  name="Comentarios"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                  fill="url(#gComments)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#fbbf24' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
