'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { getComputedClientMetrics, saveMetricsNotes, type ComputedMetricsRow } from '@/lib/actions/funnel'
import { formatCurrency } from '@/lib/utils'

type PeriodType = 'weekly' | 'monthly' | 'daily'

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(num: number, den: number): string {
  if (!den) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

function fmtPeriod(start: string, end: string, type: PeriodType): string {
  const s = new Date(start + 'T12:00:00Z')
  if (type === 'daily') return s.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  if (type === 'monthly') return s.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const e = new Date(end + 'T12:00:00Z')
  return `${s.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}

// ── Read-only cell (computed live) ──────────────────────────────────────────

function ReadCell({ value, currency = false, dim = false }: { value: number; currency?: boolean; dim?: boolean }) {
  const display = currency ? formatCurrency(value) : String(value)
  return (
    <td className="px-2 py-1.5 text-right bg-white/[0.008]">
      <span className={`text-xs font-mono ${dim ? 'text-zinc-600' : 'text-zinc-400'}`}>{display}</span>
    </td>
  )
}

// ── Editable cell (Seguidores + / Notas — the only manual inputs left) ─────

function EditCell({ value, onChange, type = 'number', placeholder = '0' }: {
  value: number | string | null
  onChange: (v: string) => void
  type?: 'number' | 'text'
  placeholder?: string
}) {
  return (
    <td className="px-1 py-1">
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md bg-transparent px-2 py-1 text-xs font-mono outline-none transition-colors
          placeholder:text-zinc-700 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.12]
          ${type === 'text' ? 'text-left' : 'text-right'} text-zinc-200`}
        min={0}
        step={type === 'number' ? 1 : undefined}
      />
    </td>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function SpreadsheetRow({ clientId, periodType, row }: {
  clientId: string
  periodType: PeriodType
  row: ComputedMetricsRow
}) {
  const [followers, setFollowers] = useState(row.followers_gained)
  const [notes, setNotes] = useState(row.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((fields: { followers_gained?: number; notes?: string | null }) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true); setSaved(false)
      try {
        await saveMetricsNotes(clientId, periodType, row.period_start, row.period_end, fields)
        setSaved(true); setTimeout(() => setSaved(false), 2000)
      } catch {}
      setSaving(false)
    }, 600)
  }, [clientId, periodType, row.period_start, row.period_end])

  const pctResp = pct(row.chats_abiertos, row.views_reels)
  const pctSeg  = pct(followers, row.views_reels)
  const pctConv = pct(row.conversaciones, row.chats_abiertos)

  return (
    <tr className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="text-xs font-mono text-zinc-300">{fmtPeriod(row.period_start, row.period_end, periodType)}</span>
      </td>

      <ReadCell value={row.views_reels} />
      <ReadCell value={row.views_historias} />
      <EditCell value={followers} onChange={(v) => { const n = parseFloat(v) || 0; setFollowers(n); persist({ followers_gained: n }) }} />
      <ReadCell value={row.chats_abiertos} />
      <ReadCell value={row.conversaciones} />
      <ReadCell value={row.agendas} />
      <ReadCell value={row.shows} />
      <ReadCell value={row.cierres} />
      <td className="px-2 py-1.5 text-right bg-white/[0.008]">
        <span className="text-xs font-mono text-emerald-500/70">{formatCurrency(row.facturacion)}</span>
      </td>
      <td className="px-2 py-1.5 text-right bg-white/[0.008]">
        <span className="text-xs font-mono text-emerald-500/70">{formatCurrency(row.cash_collected)}</span>
      </td>

      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctResp}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctSeg}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctConv}</span></td>

      <EditCell value={notes} onChange={(v) => { setNotes(v); persist({ notes: v || null }) }} type="text" placeholder="Notas..." />

      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {saving && <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" />}
          {saved && !saving && <Check className="h-3 w-3 text-emerald-400" />}
        </div>
      </td>
    </tr>
  )
}

// ── Totals row ────────────────────────────────────────────────────────────────

function TotalsRow({ rows }: { rows: ComputedMetricsRow[] }) {
  const sum = (key: keyof ComputedMetricsRow) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  const vr = sum('views_reels')
  const ch = sum('chats_abiertos')
  const fg = sum('followers_gained')
  const conv = sum('conversaciones')

  return (
    <tr className="border-t border-white/[0.1] bg-white/[0.02]">
      <td className="px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Total</span>
      </td>
      {[
        sum('views_reels'), sum('views_historias'), sum('followers_gained'),
        sum('chats_abiertos'), sum('conversaciones'), sum('agendas'),
        sum('shows'), sum('cierres'),
      ].map((v, i) => (
        <td key={i} className="px-2 py-2 text-right">
          <span className="text-xs font-mono font-semibold text-zinc-300">{v.toLocaleString('es')}</span>
        </td>
      ))}
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono font-semibold text-emerald-400">
          {formatCurrency(sum('facturacion'))}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono font-semibold text-emerald-400">
          {formatCurrency(sum('cash_collected'))}
        </span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono text-zinc-500">{pct(ch, vr)}</span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono text-zinc-500">{pct(fg, vr)}</span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono text-zinc-500">{pct(conv, ch)}</span>
      </td>
      <td colSpan={2} />
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'daily', label: 'Diario' },
]

const HEADERS = [
  { label: 'Período', align: 'left' },
  { label: 'Views Reels', align: 'right' },
  { label: 'Views Historias', align: 'right' },
  { label: 'Seguidores +', align: 'right' },
  { label: 'Chats', align: 'right' },
  { label: 'Convs.', align: 'right' },
  { label: 'Agendas', align: 'right' },
  { label: 'Shows', align: 'right' },
  { label: 'Cierres', align: 'right' },
  { label: 'Facturación', align: 'right' },
  { label: 'Cash', align: 'right' },
  { label: '% Resp.', align: 'right', dim: true },
  { label: '% Seguid.', align: 'right', dim: true },
  { label: '% Conv.', align: 'right', dim: true },
  { label: 'Notas', align: 'left' },
  { label: '', align: 'right' },
]

export function MetricsSpreadsheet({ clientId }: { clientId: string }) {
  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  const [rows, setRows] = useState<ComputedMetricsRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const data = await getComputedClientMetrics(clientId, periodType, 12)
      if (!cancelled) { setRows(data); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [clientId, periodType])

  // Only show periods with some activity — a wall of empty rows is just noise
  const activeRows = rows.filter((r) =>
    r.views_reels + r.views_historias + r.chats_abiertos + r.agendas + r.followers_gained > 0 || r.notes
  )

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriodType(p.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                periodType === p.value
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {HEADERS.map((h, i) => (
                  <th
                    key={i}
                    className={`px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap
                      ${h.align === 'right' ? 'text-right' : 'text-left'}
                      ${h.dim ? 'text-zinc-600' : 'text-zinc-500'}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={HEADERS.length} className="py-12 text-center text-zinc-600 text-xs">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Cargando...
                  </td>
                </tr>
              ) : activeRows.length === 0 ? (
                <tr>
                  <td colSpan={HEADERS.length} className="py-12 text-center">
                    <p className="text-zinc-600 text-xs">Sin actividad en los últimos períodos</p>
                  </td>
                </tr>
              ) : (
                <>
                  {activeRows.map((row) => (
                    <SpreadsheetRow key={row.period_start} clientId={clientId} periodType={periodType} row={row} />
                  ))}
                  <TotalsRow rows={activeRows} />
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">
        Datos en vivo desde ManyChat, Calendly y Meta · Solo Seguidores+ y Notas son manuales
      </p>
    </div>
  )
}
