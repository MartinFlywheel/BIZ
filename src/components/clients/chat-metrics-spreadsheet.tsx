'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { getDailyLiveMetrics, type DailyLiveMetric } from '@/lib/actions/chat-metrics'
import { formatCurrency } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekOfMonth(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z').getDate()
  if (d <= 7) return 1; if (d <= 14) return 2; if (d <= 21) return 3; if (d <= 28) return 4; return 5
}

function pct(a: number, b: number): string {
  return b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—'
}

function perUnit(money: number, units: number): string {
  return units > 0 ? formatCurrency(money / units) : '—'
}

// ── MonthSelector ─────────────────────────────────────────────────────────────

function MonthSelector({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const now = new Date()
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
  const cls = 'rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-500 [&>option]:bg-zinc-900'
  return (
    <div className="flex items-center gap-2">
      <select value={month} onChange={e => onChange(year, +e.target.value)} className={cls}>
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select value={year} onChange={e => onChange(+e.target.value, month)} className={cls}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// Calculated / read-only cell — no background, muted color
function ReadCell({ value, emerald = false, dim = false }: { value: string; emerald?: boolean; dim?: boolean }) {
  return (
    <td className="px-2 py-1 text-right bg-white/[0.008] select-none">
      <span className={`text-xs font-mono ${emerald ? 'text-emerald-500/70' : dim ? 'text-zinc-700' : 'text-zinc-400'}`}>{value}</span>
    </td>
  )
}

// ── ChatRow ───────────────────────────────────────────────────────────────────

function ChatRow({ row }: { row: DailyLiveMetric }) {
  const tasa_ag  = pct(row.agendas, row.chats_abiertos)
  const closer_r = pct(row.cierres, row.llamadas)
  const show_r   = pct(row.shows, row.llamadas)
  const aov      = perUnit(row.facturacion, row.cierres)
  const cc_ll    = perUnit(row.cash_collected, row.llamadas)
  const cc_sh    = perUnit(row.cash_collected, row.shows)
  const cc_ci    = perUnit(row.cash_collected, row.cierres)
  const fa_ll    = perUnit(row.facturacion, row.llamadas)
  const fa_sh    = perUnit(row.facturacion, row.shows)
  const fa_ci    = perUnit(row.facturacion, row.cierres)

  return (
    <tr className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-2 py-1 whitespace-nowrap">
        <span className="text-xs font-mono text-zinc-300">{row.date}</span>
      </td>
      {/* SETTING — computed from interactions (ManyChat) */}
      <ReadCell value={String(row.chats_abiertos)} />
      <ReadCell value={String(row.conversaciones)} />
      <ReadCell value={String(row.agendas)} />
      {/* CLOSING — computed from agenda_records (Calendly + CRM) */}
      <ReadCell value={String(row.llamadas)} />
      <ReadCell value={String(row.shows)} />
      <ReadCell value={String(row.llamadas_no_calificadas)} />
      <ReadCell value={String(row.cierres)} />
      <ReadCell value="0" dim />
      <ReadCell value={formatCurrency(row.facturacion)} emerald />
      <ReadCell value={formatCurrency(row.cash_collected)} emerald />
      {/* Calculated */}
      <ReadCell value={tasa_ag} dim />
      <ReadCell value={closer_r} dim />
      <ReadCell value={show_r} dim />
      <ReadCell value={aov} emerald />
      <ReadCell value={cc_ll} dim />
      <ReadCell value={cc_sh} dim />
      <ReadCell value={cc_ci} emerald />
      <ReadCell value={fa_ll} dim />
      <ReadCell value={fa_sh} dim />
      <ReadCell value={fa_ci} dim />
    </tr>
  )
}

// ── TotalsRow ─────────────────────────────────────────────────────────────────

function TotalsRow({ rows, label }: { rows: DailyLiveMetric[]; label: string }) {
  const sum = (k: keyof PeriodMetricsSumKeys) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)

  const ch = sum('chats_abiertos'), ag = sum('agendas')
  const ll = sum('llamadas'), sh = sum('shows'), ci = sum('cierres')
  const fact = sum('facturacion'), cash = sum('cash_collected')

  return (
    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
      <td className="px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      </td>
      {[sum('chats_abiertos'), sum('conversaciones'), sum('agendas')].map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right">
          <span className="text-xs font-mono font-semibold text-zinc-300">{v}</span>
        </td>
      ))}
      {[ll, sh, sum('llamadas_no_calificadas'), ci, 0].map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right bg-white/[0.004]">
          <span className="text-xs font-mono font-semibold text-zinc-400">{v}</span>
        </td>
      ))}
      <td className="px-2 py-1.5 text-right bg-white/[0.004]">
        <span className="text-xs font-mono font-semibold text-emerald-400">{formatCurrency(fact)}</span>
      </td>
      <td className="px-2 py-1.5 text-right bg-white/[0.004]">
        <span className="text-xs font-mono font-semibold text-emerald-300">{formatCurrency(cash)}</span>
      </td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pct(ag, ch)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pct(ci, ll)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pct(sh, ll)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(fact, ci)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(cash, ll)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(cash, sh)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(cash, ci)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(fact, ll)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(fact, sh)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{perUnit(fact, ci)}</span></td>
    </tr>
  )
}

type PeriodMetricsSumKeys = Pick<DailyLiveMetric, 'chats_abiertos' | 'conversaciones' | 'agendas' | 'llamadas' | 'llamadas_no_calificadas' | 'shows' | 'cierres' | 'facturacion' | 'cash_collected'>

// ── Main component ────────────────────────────────────────────────────────────

const SETTING_HEADERS = ['Chats', 'Convs.', 'Agendas']
const CLOSING_HEADERS = ['Llamadas', 'Shows', 'No Cal.', 'Cierres', 'Señados', 'Facturación', 'Cash']
const CALC_HEADERS = ['%Agenda', 'Closer%', 'Show%', 'AOV', 'CC/Ll.', 'CC/Sh.', 'CC/Ci.', 'Fact/Ll.', 'Fact/Sh.', 'Fact/Ci.']

export function ChatMetricsSpreadsheet({ clientId }: { clientId: string }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [rows, setRows]   = useState<DailyLiveMetric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const data = await getDailyLiveMetrics(clientId, year, month)
      if (!cancelled) { setRows(data); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [clientId, year, month])

  // Only show days with some activity — a full empty month is just noise
  const activeRows = rows.filter((r) =>
    r.chats_abiertos + r.conversaciones + r.agendas + r.llamadas > 0
  )

  // Group by week
  const weeks = new Map<number, DailyLiveMetric[]>()
  for (const r of activeRows) {
    const w = weekOfMonth(r.date)
    if (!weeks.has(w)) weeks.set(w, [])
    weeks.get(w)!.push(r)
  }

  const totalCols = 1 + SETTING_HEADERS.length + CLOSING_HEADERS.length + CALC_HEADERS.length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: '1280px' }}>
            {/* Two-row header */}
            <thead>
              <tr className="border-b border-white/[0.04] bg-white/[0.02]">
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600" rowSpan={2}>Fecha</th>
                <th colSpan={SETTING_HEADERS.length}
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500 border-l border-white/[0.06]">
                  Setting
                </th>
                <th colSpan={CLOSING_HEADERS.length}
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-violet-400 border-l border-white/[0.06]">
                  Closing
                </th>
                <th colSpan={CALC_HEADERS.length}
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-700 border-l-2 border-white/[0.08] bg-white/[0.01]">
                  Calculado
                </th>
              </tr>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {SETTING_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-blue-500/70 whitespace-nowrap ${i === 0 ? 'border-l border-white/[0.06]' : ''}`}>{h}</th>
                ))}
                {CLOSING_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-violet-400/70 whitespace-nowrap ${i === 0 ? 'border-l border-white/[0.06]' : ''}`}>{h}</th>
                ))}
                {CALC_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-700 whitespace-nowrap bg-white/[0.01] ${i === 0 ? 'border-l-2 border-white/[0.08]' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={totalCols} className="py-12 text-center text-zinc-600 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : activeRows.length === 0 ? (
                <tr><td colSpan={totalCols} className="py-12 text-center text-zinc-600 text-xs">
                  Sin actividad este mes
                </td></tr>
              ) : (
                Array.from(weeks.entries()).sort(([a], [b]) => a - b).map(([week, wRows]) => (
                  <>
                    {/* Week label */}
                    <tr key={`wh-${week}`} className="bg-white/[0.015]">
                      <td colSpan={totalCols} className="px-3 py-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Semana {week}</span>
                      </td>
                    </tr>

                    {wRows.map(r => <ChatRow key={r.date} row={r} />)}

                    <TotalsRow key={`wt-${week}`} rows={wRows} label={`Total sem. ${week}`} />
                  </>
                ))
              )}

              {activeRows.length > 1 && (
                <TotalsRow rows={activeRows} label="Total Mes" />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">Datos en vivo desde ManyChat y Calendly · Se actualiza solo</p>
    </div>
  )
}
