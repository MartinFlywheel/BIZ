'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Check, Loader2 } from 'lucide-react'
import {
  getDailyChatMetrics, saveDailyChatMetric, deleteDailyChatMetric,
  type DailyChatMetric,
} from '@/lib/actions/chat-metrics'
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

// ── Editable cell ─────────────────────────────────────────────────────────────

function Cell({ value, onChange, currency = false }: {
  value: number
  onChange: (v: string) => void
  currency?: boolean
}) {
  return (
    <td className="px-0.5 py-0.5">
      <input
        type="number"
        value={value || ''}
        placeholder="0"
        onChange={e => onChange(e.target.value)}
        className="w-full min-w-[52px] rounded-md bg-transparent px-1.5 py-1 text-right text-xs font-mono text-zinc-200 outline-none placeholder:text-zinc-700 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.12] transition-colors"
        min={0}
        step={currency ? 0.01 : 1}
      />
    </td>
  )
}

function ReadCell({ value, emerald = false }: { value: string; emerald?: boolean }) {
  return (
    <td className="px-2 py-1 text-right">
      <span className={`text-xs font-mono ${emerald ? 'text-emerald-400' : 'text-zinc-600'}`}>{value}</span>
    </td>
  )
}

// ── ChatRow ───────────────────────────────────────────────────────────────────

type RowState = Omit<DailyChatMetric, 'id' | 'client_id' | 'created_at'>

function ChatRow({ clientId, initialData, onDelete }: {
  clientId: string
  initialData: RowState
  onDelete: () => void
}) {
  const [row, setRow] = useState<RowState>(initialData)
  const originalDateRef = useRef(initialData.date)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((next: RowState) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true); setSaved(false)
      try {
        if (next.date !== originalDateRef.current) {
          await deleteDailyChatMetric(clientId, originalDateRef.current)
          originalDateRef.current = next.date
        }
        await saveDailyChatMetric(clientId, next.date, {
          chats_abiertos: next.chats_abiertos,
          conversaciones: next.conversaciones,
          agendas: next.agendas,
          llamadas: next.llamadas,
          shows: next.shows,
          llamadas_no_calificadas: next.llamadas_no_calificadas,
          cierres: next.cierres,
          seniados: next.seniados,
          total_facturacion: next.total_facturacion,
          total_cash: next.total_cash,
        })
        setSaved(true); setTimeout(() => setSaved(false), 2000)
      } catch {}
      setSaving(false)
    }, 600)
  }, [clientId])

  function set(field: keyof RowState, raw: string) {
    const isDate = field === 'date'
    const parsed = isDate ? raw : (parseFloat(raw) || 0)
    const next = { ...row, [field]: parsed }
    setRow(next)
    persist(next)
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar este día?')) return
    await deleteDailyChatMetric(clientId, originalDateRef.current)
    onDelete()
  }

  // Calculated
  const r = row
  const tasa_ag   = pct(r.agendas, r.chats_abiertos)
  const closer_r  = pct(r.cierres, r.llamadas)
  const show_r    = pct(r.shows, r.llamadas)
  const aov       = perUnit(r.total_facturacion, r.cierres)
  const cc_ll     = perUnit(r.total_cash, r.llamadas)
  const cc_sh     = perUnit(r.total_cash, r.shows)
  const cc_ci     = perUnit(r.total_cash, r.cierres)
  const fa_ll     = perUnit(r.total_facturacion, r.llamadas)
  const fa_sh     = perUnit(r.total_facturacion, r.shows)
  const fa_ci     = perUnit(r.total_facturacion, r.cierres)

  return (
    <tr className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-1 py-0.5">
        <input type="date" value={row.date} onChange={e => set('date', e.target.value)}
          className="rounded-md bg-transparent px-1.5 py-1 text-xs font-mono text-zinc-300 outline-none hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.12] [color-scheme:dark] transition-colors w-[112px]" />
      </td>
      {/* SETTING */}
      <Cell value={r.chats_abiertos}         onChange={v => set('chats_abiertos', v)} />
      <Cell value={r.conversaciones}          onChange={v => set('conversaciones', v)} />
      <Cell value={r.agendas}                onChange={v => set('agendas', v)} />
      {/* CLOSING */}
      <Cell value={r.llamadas}               onChange={v => set('llamadas', v)} />
      <Cell value={r.shows}                  onChange={v => set('shows', v)} />
      <Cell value={r.llamadas_no_calificadas} onChange={v => set('llamadas_no_calificadas', v)} />
      <Cell value={r.cierres}                onChange={v => set('cierres', v)} />
      <Cell value={r.seniados}               onChange={v => set('seniados', v)} />
      <Cell value={r.total_facturacion}      onChange={v => set('total_facturacion', v)} currency />
      <Cell value={r.total_cash}             onChange={v => set('total_cash', v)} currency />
      {/* Calculated */}
      <ReadCell value={tasa_ag} />
      <ReadCell value={closer_r} />
      <ReadCell value={show_r} />
      <ReadCell value={aov} emerald />
      <ReadCell value={cc_ll} />
      <ReadCell value={cc_sh} />
      <ReadCell value={cc_ci} emerald />
      <ReadCell value={fa_ll} />
      <ReadCell value={fa_sh} />
      <ReadCell value={fa_ci} emerald />
      {/* Actions */}
      <td className="px-1 py-1">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {saving && <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" />}
          {saved && !saving && <Check className="h-3 w-3 text-emerald-400" />}
          <button onClick={handleDelete} className="text-zinc-700 hover:text-red-400 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── TotalsRow ─────────────────────────────────────────────────────────────────

function TotalsRow({ rows, label }: { rows: RowState[]; label: string }) {
  const sum = (k: keyof RowState) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const ch = sum('chats_abiertos'), ag = sum('agendas'), ll = sum('llamadas')
  const sh = sum('shows'), ci = sum('cierres')
  const fact = sum('total_facturacion'), cash = sum('total_cash')

  return (
    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
      <td className="px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      </td>
      {[sum('chats_abiertos'), sum('conversaciones'), sum('agendas'),
        sum('llamadas'), sum('shows'), sum('llamadas_no_calificadas'),
        sum('cierres'), sum('seniados')].map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right">
          <span className="text-xs font-mono font-semibold text-zinc-300">{v}</span>
        </td>
      ))}
      <td className="px-2 py-1.5 text-right">
        <span className="text-xs font-mono font-semibold text-emerald-400">{formatCurrency(fact)}</span>
      </td>
      <td className="px-2 py-1.5 text-right">
        <span className="text-xs font-mono font-semibold text-emerald-300">{formatCurrency(cash)}</span>
      </td>
      {/* Calculated totals */}
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
      <td />
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const SETTING_HEADERS = ['Chats', 'Convs.', 'Agendas']
const CLOSING_HEADERS = ['Llamadas', 'Shows', 'No Cal.', 'Cierres', 'Señados', 'Facturación', 'Cash']
const CALC_HEADERS = ['%Agenda', 'Closer%', 'Show%', 'AOV', 'CC/Ll.', 'CC/Sh.', 'CC/Ci.', 'Fact/Ll.', 'Fact/Sh.', 'Fact/Ci.']

export function ChatMetricsSpreadsheet({ clientId }: { clientId: string }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [rows, setRows]   = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = await getDailyChatMetrics(clientId, year, month)
      setRows(data.map(d => ({
        date: d.date,
        chats_abiertos: d.chats_abiertos || 0,
        conversaciones: d.conversaciones || 0,
        agendas: d.agendas || 0,
        llamadas: d.llamadas || 0,
        shows: d.shows || 0,
        llamadas_no_calificadas: d.llamadas_no_calificadas || 0,
        cierres: d.cierres || 0,
        seniados: d.seniados || 0,
        total_facturacion: d.total_facturacion || 0,
        total_cash: d.total_cash || 0,
      })))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [clientId, year, month])

  function addRow() {
    const today = new Date()
    const date = (year === today.getFullYear() && month === today.getMonth() + 1)
      ? today.toISOString().split('T')[0]
      : `${year}-${String(month).padStart(2, '0')}-01`
    if (rows.some(r => r.date === date)) return
    const newRow: RowState = { date, chats_abiertos: 0, conversaciones: 0, agendas: 0, llamadas: 0, shows: 0, llamadas_no_calificadas: 0, cierres: 0, seniados: 0, total_facturacion: 0, total_cash: 0 }
    setRows(prev => [...prev, newRow].sort((a, b) => a.date.localeCompare(b.date)))
    saveDailyChatMetric(clientId, date, {}).catch(() => {})
  }

  function removeRow(date: string) {
    setRows(prev => prev.filter(r => r.date !== date))
  }

  // Group by week
  const weeks = new Map<number, RowState[]>()
  for (const r of rows) {
    const w = weekOfMonth(r.date)
    if (!weeks.has(w)) weeks.set(w, [])
    weeks.get(w)!.push(r)
  }

  const totalCols = 1 + SETTING_HEADERS.length + CLOSING_HEADERS.length + CALC_HEADERS.length + 1

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
        <button onClick={addRow}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Agregar día
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: '1320px' }}>
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
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-600 border-l border-white/[0.06]">
                  Calculado
                </th>
                <th rowSpan={2} />
              </tr>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {SETTING_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-blue-500/70 whitespace-nowrap ${i === 0 ? 'border-l border-white/[0.06]' : ''}`}>{h}</th>
                ))}
                {CLOSING_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-violet-400/70 whitespace-nowrap ${i === 0 ? 'border-l border-white/[0.06]' : ''}`}>{h}</th>
                ))}
                {CALC_HEADERS.map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-600 whitespace-nowrap ${i === 0 ? 'border-l border-white/[0.06]' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={totalCols} className="py-12 text-center text-zinc-600 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={totalCols} className="py-12 text-center text-zinc-600 text-xs">
                  Sin datos — agregá el primer día
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

                    {wRows.map(r => (
                      <ChatRow key={r.date} clientId={clientId} initialData={r} onDelete={() => removeRow(r.date)} />
                    ))}

                    <TotalsRow key={`wt-${week}`} rows={wRows} label={`Total sem. ${week}`} />
                  </>
                ))
              )}

              {rows.length > 1 && (
                <TotalsRow rows={rows} label="Total Mes" />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">Los cambios se guardan automáticamente · Las columnas grises se calculan solas</p>
    </div>
  )
}
