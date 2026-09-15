'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { getComputedClientMetrics, saveMetricsOverrides, type ComputedMetricsRow } from '@/lib/actions/funnel'
import type { OverridableField } from '@/lib/metrics-types'
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

// ── Computed cell — editable to allow a manual correction. Shows the live
// value by default; typing a number overrides it (amber); clearing the
// input reverts to the live value. ─────────────────────────────────────────

function OverrideCell({ value, isOverride, onChange, currency = false, editable = true }: {
  value: number
  isOverride: boolean
  onChange: (v: string) => void
  currency?: boolean
  editable?: boolean
}) {
  if (!editable) {
    return (
      <td className="px-2 py-1.5 text-right bg-white/[0.008]">
        <span className="text-xs font-mono text-zinc-400">{currency ? formatCurrency(value) : value}</span>
      </td>
    )
  }

  return (
    <td className="px-1 py-1">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={isOverride ? 'Corregido a mano — borra el valor para volver al cálculo automático' : 'Calculado automáticamente'}
        className={`w-full rounded-md px-2 py-1 text-right text-xs font-mono outline-none transition-colors
          hover:bg-white/[0.04] focus:bg-white/[0.06] focus:ring-1
          ${isOverride
            ? 'text-amber-400 bg-amber-500/[0.06] focus:ring-amber-500/30'
            : 'text-zinc-400 bg-white/[0.008] focus:ring-white/[0.12]'}`}
        min={0}
        step={currency ? 0.01 : 1}
      />
    </td>
  )
}

// ── Reel/Historia split — informational only, not overridable (the split is
// derived from the aggregate above, which is where corrections belong) ────

function SplitCell({ value }: { value: number }) {
  return (
    <td className="px-2 py-1.5 text-right bg-white/[0.004]">
      <span className="text-[11px] font-mono text-zinc-600">{value || '—'}</span>
    </td>
  )
}

// ── Celda editable de texto (Notas, el único campo sin fuente automática) ────

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
  const [overrides, setOverrides] = useState<Partial<Record<OverridableField, number>>>(row.overrides)
  const [notes, setNotes] = useState(row.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cambios aún sin guardar. Se acumulan porque el guardado espera 600 ms: si
  // en ese lapso se tocaban dos columnas, antes solo viajaba la última.
  const pendingRef = useRef<CambiosPendientes>({})

  const persist = useCallback((fields: CambiosPendientes) => {
    pendingRef.current = { ...pendingRef.current, ...fields }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const pending = pendingRef.current
      pendingRef.current = {}
      setSaving(true); setSaved(false); setError(null)
      try {
        const res = await saveMetricsOverrides(clientId, periodType, row.period_start, row.period_end, pending)
        if (res.error) {
          setError(res.error)
        } else {
          setSaved(true); setTimeout(() => setSaved(false), 2000)
        }
      } catch (e) {
        // Un corte de red o un error del servidor no puede verse como guardado.
        setError(e instanceof Error && e.message
          ? `No se pudo guardar: ${e.message}`
          : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.')
      }
      setSaving(false)
    }, 600)
  }, [clientId, periodType, row.period_start, row.period_end])

  function setField(field: OverridableField, raw: string) {
    if (raw === '') {
      setOverrides((o) => { const next = { ...o }; delete next[field]; return next })
      persist({ [field]: null })
    } else {
      const n = parseFloat(raw) || 0
      setOverrides((o) => ({ ...o, [field]: n }))
      persist({ [field]: n })
    }
  }

  const displayValue = (field: OverridableField) => overrides[field] ?? row.live[field]
  const editable = periodType === 'daily'

  const cell = (field: OverridableField, currency = false) => (
    <OverrideCell
      value={displayValue(field)}
      isOverride={field in overrides}
      onChange={(v) => setField(field, v)}
      currency={currency}
      editable={editable}
    />
  )

  // Mismo denominador para % Resp. y % Seguid.: todas las vistas del contenido
  // con CTA (reels + carruseles + historias). Views Carruseles no es
  // corregible (client_metrics no tiene esa columna), así que va en vivo.
  const totalViews = displayValue('views_reels') + row.views_carruseles + displayValue('views_historias')
  const pctResp = pct(displayValue('chats_abiertos'), totalViews)
  const pctSeg  = pct(displayValue('followers_gained'), totalViews)
  const pctConv = pct(displayValue('conversaciones'), displayValue('chats_abiertos'))

  return (
    <tr className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="text-xs font-mono text-zinc-300">{fmtPeriod(row.period_start, row.period_end, periodType)}</span>
      </td>

      {cell('views_reels')}
      <OverrideCell value={row.views_carruseles} isOverride={false} onChange={() => {}} editable={false} />
      {cell('views_historias')}
      {cell('followers_gained')}
      {cell('chats_abiertos')}
      <SplitCell value={row.chats_abiertos_reel} />
      <SplitCell value={row.chats_abiertos_historia} />
      {cell('conversaciones')}
      <SplitCell value={row.conversaciones_reel} />
      <SplitCell value={row.conversaciones_historia} />
      {cell('agendas')}
      {cell('shows')}
      {cell('cierres')}
      {cell('facturacion', true)}
      {cell('cash_collected', true)}

      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctResp}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctSeg}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="text-xs font-mono text-zinc-500">{pctConv}</span></td>

      <EditCell value={notes} onChange={(v) => { setNotes(v); persist({ notes: v || null }) }} type="text" placeholder="Notas..." />

      <td className="px-2 py-1.5">
        {error ? (
          <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-red-400" title={error} role="alert">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            No se guardó
          </span>
        ) : (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {saving && <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" />}
            {saved && !saving && <Check className="h-3 w-3 text-emerald-400" />}
          </div>
        )}
      </td>
    </tr>
  )
}

type CambiosPendientes = Partial<Record<OverridableField, number | null>> & { notes?: string | null }

// ── Totals row ────────────────────────────────────────────────────────────────

function TotalsRow({ rows }: { rows: ComputedMetricsRow[] }) {
  const sum = (key: keyof ComputedMetricsRow) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  const totalViews = sum('views_reels') + sum('views_carruseles') + sum('views_historias')
  const ch = sum('chats_abiertos')
  const fg = sum('followers_gained')
  const conv = sum('conversaciones')

  return (
    <tr className="border-t border-white/[0.1] bg-white/[0.02]">
      <td className="px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Total</span>
      </td>
      {[sum('views_reels'), sum('views_carruseles'), sum('views_historias'), fg].map((v, i) => (
        <td key={i} className="px-2 py-2 text-right">
          <span className="text-xs font-mono font-semibold text-zinc-300">{v.toLocaleString('es')}</span>
        </td>
      ))}
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono font-semibold text-zinc-300">{ch.toLocaleString('es')}</span>
      </td>
      <td className="px-2 py-2 text-right"><span className="text-[11px] font-mono text-zinc-600">{sum('chats_abiertos_reel').toLocaleString('es')}</span></td>
      <td className="px-2 py-2 text-right"><span className="text-[11px] font-mono text-zinc-600">{sum('chats_abiertos_historia').toLocaleString('es')}</span></td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono font-semibold text-zinc-300">{conv.toLocaleString('es')}</span>
      </td>
      <td className="px-2 py-2 text-right"><span className="text-[11px] font-mono text-zinc-600">{sum('conversaciones_reel').toLocaleString('es')}</span></td>
      <td className="px-2 py-2 text-right"><span className="text-[11px] font-mono text-zinc-600">{sum('conversaciones_historia').toLocaleString('es')}</span></td>
      {[sum('agendas'), sum('shows'), sum('cierres')].map((v, i) => (
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
        <span className="text-xs font-mono text-zinc-500">{pct(ch, totalViews)}</span>
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono text-zinc-500">{pct(fg, totalViews)}</span>
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

// Cuántos períodos pedir como máximo. La tabla nunca arranca antes del inicio
// del cliente en el CRM (getComputedClientMetrics lo recorta), así que Semanal
// y Mensual muestran desde ahí hasta hoy con un tope de 24 meses. Diario se
// queda en los últimos 12 días, que es donde se hacen las correcciones.
const PERIODOS_A_MOSTRAR: Record<PeriodType, number> = {
  monthly: 24,
  weekly: 104,
  daily: 12,
}

const HEADERS = [
  { label: 'Período', align: 'left' },
  { label: 'Views Reels', align: 'right' },
  { label: 'Views Carruseles', align: 'right' },
  { label: 'Views Historias', align: 'right' },
  { label: 'Seguidores +', align: 'right' },
  { label: 'Chats', align: 'right' },
  { label: 'Chats Reel', align: 'right', dim: true },
  { label: 'Chats Historia', align: 'right', dim: true },
  { label: 'Convs.', align: 'right' },
  { label: 'Convs Reel', align: 'right', dim: true },
  { label: 'Convs Historia', align: 'right', dim: true },
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
      const data = await getComputedClientMetrics(clientId, periodType, PERIODOS_A_MOSTRAR[periodType])
      if (!cancelled) { setRows(data); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [clientId, periodType])

  // Only show periods with some activity — a wall of empty rows is just noise
  const activeRows = rows.filter((r) =>
    r.views_reels + r.views_carruseles + r.views_historias + r.chats_abiertos + r.agendas + r.followers_gained > 0 || r.notes
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
                    <p className="text-zinc-600 text-xs">Sin actividad desde el inicio del cliente</p>
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

      <div className="space-y-1 text-[11px] text-zinc-700">
        <p>
          Datos en vivo desde ManyChat, Calendly y Meta · Las correcciones se hacen desde{' '}
          <span className="text-zinc-500">Diario</span> (<span className="text-amber-400">ámbar</span> = corregido,
          vacío = automático) — Semanal y Mensual son la suma de esos días · El período en curso cuenta solo hasta hoy
        </p>
        <p>
          <span className="text-zinc-500">% Resp.</span> = Chats ÷ (Views Reels + Views Carruseles + Views Historias) ·{' '}
          <span className="text-zinc-500">% Seguid.</span> = Seguidores + ÷ esas mismas vistas ·{' '}
          <span className="text-zinc-500">% Conv.</span> = Convs. ÷ Chats
        </p>
        <p>
          Views Reels y Views Carruseles son las vistas de por vida de cada publicación, asignadas al día en que se
          publicó · Views Historias y Seguidores + salen de los insights diarios de la cuenta de Instagram (días en
          hora del Pacífico, como los entrega Meta); los días sin ese dato usan las vistas guardadas de cada historia ·
          Facturación usa el upfront cuando la agenda cerrada no tiene monto de facturación
        </p>
      </div>
    </div>
  )
}
