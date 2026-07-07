'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Check, Loader2 } from 'lucide-react'
import { getClientMetrics, saveMetricsRow, deleteMetricsRow, type MetricsRow } from '@/lib/actions/funnel'
import { formatCurrency } from '@/lib/utils'

type PeriodType = 'weekly' | 'monthly' | 'daily'

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(num: number, den: number): string {
  if (!den) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

function mondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function sundayOf(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00Z')
  d.setDate(d.getDate() + 6)
  return d.toISOString().split('T')[0]
}

function firstOfMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function lastOfMonth(firstStr: string): string {
  const d = new Date(firstStr + 'T12:00:00Z')
  d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}

function fmtPeriod(start: string, end: string, type: PeriodType): string {
  const s = new Date(start + 'T12:00:00Z')
  if (type === 'daily') return s.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  if (type === 'monthly') return s.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const e = new Date(end + 'T12:00:00Z')
  return `${s.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}

function newPeriodDates(type: PeriodType): { start: string; end: string } {
  const now = new Date()
  if (type === 'daily') {
    const d = now.toISOString().split('T')[0]
    return { start: d, end: d }
  }
  if (type === 'monthly') {
    const start = firstOfMonth(now)
    return { start, end: lastOfMonth(start) }
  }
  const start = mondayOf(now)
  return { start, end: sundayOf(start) }
}

// ── Editable cell ─────────────────────────────────────────────────────────────

function Cell({
  value,
  onChange,
  type = 'number',
  placeholder = '0',
  currency = false,
  readOnly = false,
  dim = false,
}: {
  value: number | string | null
  onChange?: (v: string) => void
  type?: 'number' | 'text'
  placeholder?: string
  currency?: boolean
  readOnly?: boolean
  dim?: boolean
}) {
  const display = readOnly
    ? currency
      ? formatCurrency(Number(value) || 0)
      : String(value ?? '—')
    : undefined

  if (readOnly) {
    return (
      <td className="px-2 py-1.5 text-right">
        <span className={`text-xs font-mono ${dim ? 'text-zinc-600' : 'text-zinc-400'}`}>
          {display}
        </span>
      </td>
    )
  }

  return (
    <td className="px-1 py-1">
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full rounded-md bg-transparent px-2 py-1 text-right text-xs font-mono outline-none transition-colors
          placeholder:text-zinc-700
          hover:bg-white/[0.04]
          focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.12]
          ${type === 'text' ? 'text-left' : 'text-right'}
          text-zinc-200`}
        min={0}
        step={type === 'number' ? 1 : undefined}
      />
    </td>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

type RowState = Omit<MetricsRow, 'client_id' | 'period_type'> & { _saving?: boolean; _saved?: boolean }

function SpreadsheetRow({
  clientId,
  periodType,
  initialData,
  onDelete,
}: {
  clientId: string
  periodType: PeriodType
  initialData: RowState
  onDelete: () => void
}) {
  const [row, setRow] = useState<RowState>(initialData)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = useCallback((field: keyof RowState, raw: string) => {
    const isNum = ['views_reels','views_historias','followers_gained','chats_abiertos',
      'conversaciones','agendas','shows','cierres'].includes(field as string)
    const isCur = ['facturacion','cash_collected'].includes(field as string)

    setRow((prev) => ({
      ...prev,
      [field]: isNum || isCur ? (parseFloat(raw) || 0) : raw || null,
    }))

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true)
      setSaved(false)
      try {
        await saveMetricsRow({
          client_id: clientId,
          period_type: periodType,
          ...row,
          [field]: isNum || isCur ? (parseFloat(raw) || 0) : raw || null,
        } as MetricsRow)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch {}
      setSaving(false)
    }, 800)
  }, [clientId, periodType, row])

  async function handleDelete() {
    if (!confirm('¿Eliminar este período?')) return
    await deleteMetricsRow(clientId, row.period_start, periodType)
    onDelete()
  }

  const pctResp = pct(row.chats_abiertos, row.views_reels)
  const pctSeg = pct(row.followers_gained, row.views_reels)
  const pctConv = pct(row.conversaciones, row.chats_abiertos)

  return (
    <tr className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      {/* Período (read-only label) */}
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className="text-xs text-zinc-400 font-medium">
          {fmtPeriod(row.period_start, row.period_end, periodType)}
        </span>
      </td>

      <Cell value={row.views_reels} onChange={(v) => set('views_reels', v)} />
      <Cell value={row.views_historias} onChange={(v) => set('views_historias', v)} />
      <Cell value={row.followers_gained} onChange={(v) => set('followers_gained', v)} />
      <Cell value={row.chats_abiertos} onChange={(v) => set('chats_abiertos', v)} />
      <Cell value={row.conversaciones} onChange={(v) => set('conversaciones', v)} />
      <Cell value={row.agendas} onChange={(v) => set('agendas', v)} />
      <Cell value={row.shows} onChange={(v) => set('shows', v)} />
      <Cell value={row.cierres} onChange={(v) => set('cierres', v)} />
      <Cell value={row.facturacion} onChange={(v) => set('facturacion', v)} currency />
      <Cell value={row.cash_collected} onChange={(v) => set('cash_collected', v)} currency />

      {/* Auto-calculated */}
      <td className="px-2 py-1.5 text-right">
        <span className="text-xs font-mono text-zinc-500">{pctResp}</span>
      </td>
      <td className="px-2 py-1.5 text-right">
        <span className="text-xs font-mono text-zinc-500">{pctSeg}</span>
      </td>
      <td className="px-2 py-1.5 text-right">
        <span className="text-xs font-mono text-zinc-500">{pctConv}</span>
      </td>

      <Cell value={row.notes ?? ''} onChange={(v) => set('notes', v)} type="text" placeholder="Notas..." />

      {/* Actions */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {saving && <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" />}
          {saved && !saving && <Check className="h-3 w-3 text-emerald-400" />}
          <button
            onClick={handleDelete}
            className="rounded p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Totals row ────────────────────────────────────────────────────────────────

function TotalsRow({ rows }: { rows: RowState[] }) {
  const sum = (key: keyof RowState) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
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
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)

  async function load(type: PeriodType) {
    setLoading(true)
    try {
      const data = await getClientMetrics(clientId, type, 52)
      setRows(
        (data || []).map((d: Record<string, unknown>) => ({
          period_start: d.period_start as string,
          period_end: d.period_end as string,
          views_reels: (d.views_reels as number) || 0,
          views_historias: (d.views_historias as number) || 0,
          followers_gained: (d.followers_gained as number) || 0,
          chats_abiertos: (d.chats_abiertos as number) || 0,
          conversaciones: (d.conversaciones as number) || 0,
          agendas: (d.agendas as number) || 0,
          shows: (d.shows as number) || 0,
          cierres: (d.cierres as number) || 0,
          facturacion: (d.facturacion as number) || 0,
          cash_collected: (d.cash_collected as number) || 0,
          notes: (d.notes as string) || null,
        }))
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(periodType) }, [clientId, periodType])

  function handlePeriodChange(type: PeriodType) {
    setPeriodType(type)
  }

  function addRow() {
    const { start, end } = newPeriodDates(periodType)
    const exists = rows.some((r) => r.period_start === start)
    if (exists) return

    const newRow: RowState = {
      period_start: start,
      period_end: end,
      views_reels: 0,
      views_historias: 0,
      followers_gained: 0,
      chats_abiertos: 0,
      conversaciones: 0,
      agendas: 0,
      shows: 0,
      cierres: 0,
      facturacion: 0,
      cash_collected: 0,
      notes: null,
    }

    setRows((prev) => [newRow, ...prev])

    // Save immediately so it exists in DB
    saveMetricsRow({ client_id: clientId, period_type: periodType, ...newRow } as MetricsRow).catch(() => {})
  }

  function removeRow(periodStart: string) {
    setRows((prev) => prev.filter((r) => r.period_start !== periodStart))
  }

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => handlePeriodChange(p.value)}
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

        <button
          onClick={addRow}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar período
        </button>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            {/* Column headers */}
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
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={HEADERS.length} className="py-12 text-center">
                    <p className="text-zinc-600 text-xs">Sin datos — agregá el primer período</p>
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((row) => (
                    <SpreadsheetRow
                      key={row.period_start}
                      clientId={clientId}
                      periodType={periodType}
                      initialData={row}
                      onDelete={() => removeRow(row.period_start)}
                    />
                  ))}
                  <TotalsRow rows={rows} />
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">
        Los cambios se guardan automáticamente · Las columnas en gris se calculan solas
      </p>
    </div>
  )
}
