'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, X, ExternalLink, Loader2, Maximize2 } from 'lucide-react'
import {
  getAgendaRecords, createAgendaRecord, updateAgendaRecord, deleteAgendaRecord,
  type AgendaRecord, type AgendaRecordFields,
} from '@/lib/actions/agenda-records'
import { LEAD_AVATARS } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ESTADO_OPTIONS = ['Pendiente','Show','No Show','No Cerrado','Cerrado','No Calificado','Reagendado']
const FORMA_CIERRE_OPTIONS = ['1 cuota','2 cuotas','3 cuotas','Pago completo','Otra']

const estadoColor: Record<string, string> = {
  'Show':           'text-emerald-400',
  'No Cerrado':     'text-orange-400',
  'Cerrado':        'text-emerald-300 font-semibold',
  'No Show':        'text-red-400',
  'No Calificado':  'text-zinc-500',
  'Reagendado':     'text-amber-400',
  'Pendiente':      'text-blue-400',
}

const estadoBg: Record<string, string> = {
  'Show':           'bg-emerald-950/40 border-emerald-900/40',
  'No Cerrado':     'bg-orange-950/40 border-orange-900/40',
  'Cerrado':        'bg-emerald-950/60 border-emerald-800/50',
  'No Show':        'bg-red-950/40 border-red-900/40',
  'No Calificado':  'bg-zinc-900 border-zinc-800',
  'Reagendado':     'bg-amber-950/40 border-amber-900/40',
  'Pendiente':      'bg-blue-950/40 border-blue-900/40',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekOfMonth(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z').getDate()
  if (d <= 7) return 1; if (d <= 14) return 2; if (d <= 21) return 3; if (d <= 28) return 4; return 5
}

function tiempoDeCompra(a: string | null, b: string | null): string {
  if (!a || !b) return '—'
  const days = Math.round((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86400000)
  return days >= 0 ? `${days}d` : '—'
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

// ── Month selector ────────────────────────────────────────────────────────────

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

// ── Full detail modal (for extra fields) ──────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500'
const selectCls = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500 [&>option]:bg-zinc-900'

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 pt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800 pb-1 mb-1">{children}</p>
    </div>
  )
}

interface ModalProps {
  record: AgendaRecord
  avatarList: readonly string[]
  onClose: () => void
  onUpdated: (id: string, fields: AgendaRecordFields) => void
  onDeleted: (id: string) => void
}

function AgendaRecordModal({ record, avatarList, onClose, onUpdated, onDeleted }: ModalProps) {
  const [local, setLocal] = useState<AgendaRecord>(record)
  const pendingRef = useRef<AgendaRecordFields>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debounceSave = useCallback((fields: AgendaRecordFields) => {
    pendingRef.current = { ...pendingRef.current, ...fields }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const toSave = pendingRef.current
      pendingRef.current = {}
      await updateAgendaRecord(record.id, toSave)
      onUpdated(record.id, toSave)
    }, 800)
  }, [record.id, onUpdated])

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      const pending = pendingRef.current
      if (Object.keys(pending).length > 0) updateAgendaRecord(record.id, pending)
    }
  }, [record.id])

  function set<K extends keyof AgendaRecordFields>(field: K, value: AgendaRecord[K]) {
    setLocal(prev => ({ ...prev, [field]: value }))
    debounceSave({ [field]: value } as AgendaRecordFields)
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar este registro?')) return
    await deleteAgendaRecord(record.id)
    onDeleted(record.id)
    onClose()
  }

  const tiempo = tiempoDeCompra(local.fecha_agenda, local.fecha_1er_contacto)

  const LinkField = ({ label, field }: { label: string; field: 'link_perfil' | 'link_reunion' | 'link_reporte' }) => (
    <Field label={label} full>
      <div className="flex gap-2">
        <input className={inputCls} value={local[field] ?? ''} placeholder="https://..."
          onChange={e => set(field, e.target.value || null)} />
        {local[field] && (
          <a href={local[field]!} target="_blank" rel="noopener noreferrer"
            className="flex items-center px-2 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors shrink-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </Field>
  )

  return (
    <Modal onClose={onClose} size="xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-zinc-100">{local.nombre_lead || 'Lead sin nombre'}</h3>
        <div className="flex items-center gap-3">
          <button onClick={handleDelete} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">Eliminar</button>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 max-h-[72vh] overflow-y-auto pr-2">
        <SectionHead>Fuente y Contacto</SectionHead>
        <Field label="Fecha 1er contacto">
          <input type="date" className={inputCls + ' [color-scheme:dark]'} value={local.fecha_1er_contacto ?? ''}
            onChange={e => set('fecha_1er_contacto', e.target.value || null)} />
        </Field>
        <Field label="Tiempo de compra">
          <div className="flex h-[34px] items-center px-3 rounded-lg border border-zinc-800 bg-zinc-900 text-sm text-zinc-400 font-mono">{tiempo}</div>
        </Field>
        <Field label="De donde vino (último CTA)">
          <input className={inputCls} value={local.de_donde_vino ?? ''} placeholder="Reel, Historia, DM..."
            onChange={e => set('de_donde_vino', e.target.value || null)} />
        </Field>
        <Field label="1er CTA">
          <input className={inputCls} value={local.primer_cta ?? ''} placeholder="Primer punto de contacto"
            onChange={e => set('primer_cta', e.target.value || null)} />
        </Field>
        <Field label="Todos los contactos (CTAs)" full>
          <input className={inputCls} value={local.todos_los_ctas ?? ''} placeholder="Lista de todos los CTAs del lead"
            onChange={e => set('todos_los_ctas', e.target.value || null)} />
        </Field>
        <LinkField label="Link al perfil" field="link_perfil" />

        <SectionHead>Llamada</SectionHead>
        <LinkField label="Link a la reunión" field="link_reunion" />
        <LinkField label="Link al reporte" field="link_reporte" />

        <SectionHead>Resultado</SectionHead>
        <Field label="Facturación actual del lead">
          <input type="number" className={inputCls} value={local.facturacion_actual ?? ''} placeholder="0"
            onChange={e => set('facturacion_actual', e.target.value ? +e.target.value : null)} />
        </Field>
        <Field label="Objeción / motivo de no cierre" full>
          <input className={inputCls} value={local.objecion ?? ''} placeholder="Objeción principal"
            onChange={e => set('objecion', e.target.value || null)} />
        </Field>
        <Field label="Situación actual del lead" full>
          <input className={inputCls} value={local.situacion_actual ?? ''} placeholder="Describe la situación actual"
            onChange={e => set('situacion_actual', e.target.value || null)} />
        </Field>

        <SectionHead>Análisis Cualitativo</SectionHead>
        <Field label="Dolores" full>
          <textarea className={inputCls} rows={2} value={local.dolores ?? ''} placeholder="Dolores del lead"
            onChange={e => set('dolores', e.target.value || null)} />
        </Field>
        <Field label="Preguntas no resueltas" full>
          <textarea className={inputCls} rows={2} value={local.preguntas_no_resueltas ?? ''} placeholder="Preguntas que quedaron sin responder"
            onChange={e => set('preguntas_no_resueltas', e.target.value || null)} />
        </Field>
        <Field label="Aporte a MKT" full>
          <input className={inputCls} value={local.aporte_a_mkt ?? ''} placeholder="Qué información útil para marketing dio el lead"
            onChange={e => set('aporte_a_mkt', e.target.value || null)} />
        </Field>

        <SectionHead>Cierre</SectionHead>
        <Field label="Programa ofrecido">
          <input className={inputCls} value={local.programa_ofrecido ?? ''} placeholder="Nombre del programa"
            onChange={e => set('programa_ofrecido', e.target.value || null)} />
        </Field>
        <Field label="Forma de cierre">
          <select className={selectCls} value={local.forma_de_cierre ?? ''} onChange={e => set('forma_de_cierre', e.target.value || null)}>
            <option value="">Seleccionar</option>
            {FORMA_CIERRE_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Razón de compra" full>
          <input className={inputCls} value={local.razon_de_compra ?? ''} placeholder="¿Por qué decidió comprar?"
            onChange={e => set('razon_de_compra', e.target.value || null)} />
        </Field>

        <SectionHead>Comentarios</SectionHead>
        <Field label="Comentarios y aclaraciones" full>
          <textarea className={inputCls} rows={3} value={local.comentarios ?? ''} placeholder="Notas adicionales..."
            onChange={e => set('comentarios', e.target.value || null)} />
        </Field>
      </div>
    </Modal>
  )
}

// ── Inline editable cell helpers ──────────────────────────────────────────────

type EditingCell = { id: string; field: string } | null

const cellInput = 'w-full bg-transparent text-inherit focus:outline-none placeholder:text-zinc-700'
const cellBase = 'px-0 py-0 h-full w-full flex items-center cursor-text text-inherit hover:bg-white/[0.03] rounded transition-colors'

// ── Main component ────────────────────────────────────────────────────────────

const HEADERS = ['Fecha', 'Nombre', 'Avatar', 'CTA', 'Closer', 'Estado', 'Facturación', 'Upfront', 'T. Compra', '']

export function AgendaSpreadsheet({ clientId, customAvatars }: { clientId: string; customAvatars?: string[] }) {
  const avatarList: readonly string[] = customAvatars && customAvatars.length > 0 ? customAvatars : LEAD_AVATARS
  const now = new Date()
  const [year, setYear]     = useState(now.getFullYear())
  const [month, setMonth]   = useState(now.getMonth() + 1)
  const [records, setRecords] = useState<AgendaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [editValue, setEditValue] = useState('')
  const [newRowId, setNewRowId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try { setRecords(await getAgendaRecords(clientId, year, month)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [clientId, year, month])

  function sortRecords(recs: AgendaRecord[]) {
    return [...recs].sort((a, b) => (a.fecha_agenda ?? '').localeCompare(b.fecha_agenda ?? ''))
  }

  async function saveCell(id: string, field: string, value: string | number | null) {
    await updateAgendaRecord(id, { [field]: value } as AgendaRecordFields)
    setRecords(prev => sortRecords(prev.map(r => r.id === id ? { ...r, [field]: value } : r)))
  }

  function startEdit(id: string, field: string, value: string) {
    setEditingCell({ id, field })
    setEditValue(value)
  }

  async function commitEdit(id: string, field: string, rawValue: string) {
    setEditingCell(null)
    const trimmed = rawValue.trim()
    const value = trimmed || null
    await saveCell(id, field, value)
  }

  async function commitNumeric(id: string, field: string, rawValue: string) {
    setEditingCell(null)
    const num = parseFloat(rawValue)
    await saveCell(id, field, isNaN(num) ? null : num)
  }

  async function handleAdd() {
    const today = new Date()
    const fecha = (year === today.getFullYear() && month === today.getMonth() + 1)
      ? today.toISOString().split('T')[0]
      : `${year}-${String(month).padStart(2, '0')}-01`
    const created = await createAgendaRecord(clientId, { fecha_agenda: fecha })
    setRecords(prev => sortRecords([...prev, created]))
    setNewRowId(created.id)
    setEditingCell({ id: created.id, field: 'nombre_lead' })
    setEditValue('')
  }

  function handleUpdated(id: string, fields: AgendaRecordFields) {
    setRecords(prev => sortRecords(prev.map(r => r.id === id ? { ...r, ...fields } : r)))
  }

  function handleDeleted(id: string) {
    setRecords(prev => prev.filter(r => r.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  async function handleDeleteRow(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('¿Eliminar este registro?')) return
    await deleteAgendaRecord(id)
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  // Group by week
  const weeks = new Map<number, AgendaRecord[]>()
  for (const r of records) {
    const w = r.fecha_agenda ? weekOfMonth(r.fecha_agenda) : 1
    if (!weeks.has(w)) weeks.set(w, [])
    weeks.get(w)!.push(r)
  }

  const grandFact    = records.reduce((s, r) => s + (r.monto_facturacion ?? 0), 0)
  const grandUpfront = records.reduce((s, r) => s + (r.monto_upfront ?? 0), 0)
  const grandCierres = records.filter(r => r.estado === 'Cerrado').length

  // ── Per-row render helper ─────────────────────────────────────────────────

  function renderRow(r: AgendaRecord) {
    const isNew = r.id === newRowId
    const ec = editingCell

    function textCell(field: string, value: string | null, placeholder: string, cls: string) {
      const active = ec?.id === r.id && ec?.field === field
      if (active) {
        return (
          <input
            autoFocus
            value={editValue}
            placeholder={placeholder}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(r.id, field, editValue)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              if (e.key === 'Escape') { setEditingCell(null) }
            }}
            className={`${cellInput} ${cls}`}
          />
        )
      }
      return (
        <span
          onClick={() => startEdit(r.id, field, value ?? '')}
          className={`${cellBase} ${cls} ${!value ? 'text-zinc-700' : ''} px-1`}
        >
          {value || placeholder}
        </span>
      )
    }

    function numCell(field: string, value: number | null, placeholder: string) {
      const active = ec?.id === r.id && ec?.field === field
      if (active) {
        return (
          <input
            autoFocus
            type="number"
            value={editValue}
            placeholder={placeholder}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitNumeric(r.id, field, editValue)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              if (e.key === 'Escape') { setEditingCell(null) }
            }}
            className={`${cellInput} text-right font-mono text-xs text-zinc-200`}
          />
        )
      }
      return (
        <span
          onClick={() => startEdit(r.id, field, value != null ? String(value) : '')}
          className={`${cellBase} justify-end font-mono text-xs cursor-text px-1 ${value ? 'text-zinc-200' : 'text-zinc-700'}`}
        >
          {value != null ? formatCurrency(value) : placeholder}
        </span>
      )
    }

    function dateCell() {
      const active = ec?.id === r.id && ec?.field === 'fecha_agenda'
      if (active) {
        return (
          <input
            autoFocus
            type="date"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(r.id, 'fecha_agenda', editValue)}
            onKeyDown={e => {
              if (e.key === 'Escape') setEditingCell(null)
            }}
            className={`${cellInput} text-xs [color-scheme:dark] text-zinc-300`}
          />
        )
      }
      return (
        <span
          onClick={() => startEdit(r.id, 'fecha_agenda', r.fecha_agenda ?? '')}
          className={`${cellBase} text-xs px-1 ${r.fecha_agenda ? 'text-zinc-300' : 'text-zinc-700'}`}
        >
          {r.fecha_agenda ? fmtDate(r.fecha_agenda) : 'Fecha'}
        </span>
      )
    }

    function avatarCell() {
      return (
        <select
          value={r.avatar ?? ''}
          onChange={e => saveCell(r.id, 'avatar', e.target.value || null)}
          className="w-full bg-transparent text-xs text-zinc-400 focus:outline-none cursor-pointer [&>option]:bg-zinc-900 border-0"
        >
          <option value="">— Avatar —</option>
          {avatarList.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )
    }

    function estadoCell() {
      const val = r.estado ?? ''
      const color = estadoColor[val] ?? 'text-zinc-600'
      const bg = estadoBg[val] ?? 'bg-transparent border-transparent'
      return (
        <select
          value={val}
          onChange={e => saveCell(r.id, 'estado', e.target.value || null)}
          className={`w-full rounded px-1.5 py-0.5 text-xs font-medium border focus:outline-none cursor-pointer [&>option]:bg-zinc-900 ${color} ${bg}`}
        >
          <option value="">— Estado —</option>
          {ESTADO_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )
    }

    return (
      <tr
        key={r.id}
        className={`group border-b border-white/[0.04] transition-colors ${isNew ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
      >
        <td className="px-2 py-1.5 text-xs w-[90px]">{dateCell()}</td>
        <td className="px-2 py-1.5 text-xs font-medium text-zinc-100 min-w-[130px] max-w-[180px]">
          {textCell('nombre_lead', r.nombre_lead, 'Nombre', 'text-sm font-medium text-zinc-100')}
        </td>
        <td className="px-2 py-1.5 text-xs w-[110px]">{avatarCell()}</td>
        <td className="px-2 py-1.5 text-xs min-w-[100px] max-w-[140px]">
          {textCell('de_donde_vino', r.de_donde_vino, 'CTA', 'text-xs text-zinc-400')}
        </td>
        <td className="px-2 py-1.5 text-xs w-[110px]">
          {textCell('closer', r.closer, 'Closer', 'text-xs text-zinc-400')}
        </td>
        <td className="px-2 py-1.5 text-xs w-[120px]">{estadoCell()}</td>
        <td className="px-2 py-1.5 text-xs w-[110px] text-right">{numCell('monto_facturacion', r.monto_facturacion, '—')}</td>
        <td className="px-2 py-1.5 text-xs w-[100px] text-right">{numCell('monto_upfront', r.monto_upfront, '—')}</td>
        <td className="px-2 py-1.5 text-xs font-mono text-right text-zinc-600 w-[70px] whitespace-nowrap">
          {tiempoDeCompra(r.fecha_agenda, r.fecha_1er_contacto)}
        </td>
        <td className="px-2 py-1.5 w-[56px]">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); setExpandedId(r.id) }}
              title="Ver todos los campos"
              className="text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              onClick={e => handleDeleteRow(r.id, e)}
              className="text-zinc-700 hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar lead
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {HEADERS.map((h, i) => (
                  <th key={i} className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={HEADERS.length} className="py-12 text-center text-zinc-600 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={HEADERS.length} className="py-12 text-center text-zinc-600 text-xs">
                  Sin registros — agregá el primer lead agendado
                </td></tr>
              ) : (
                Array.from(weeks.entries()).sort(([a], [b]) => a - b).flatMap(([week, recs]) => {
                  const wFact = recs.reduce((s, r) => s + (r.monto_facturacion ?? 0), 0)
                  const wUp   = recs.reduce((s, r) => s + (r.monto_upfront ?? 0), 0)
                  return [
                    <tr key={`week-${week}`} className="bg-white/[0.015]">
                      <td colSpan={HEADERS.length} className="px-3 py-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Semana {week}</span>
                      </td>
                    </tr>,
                    ...recs.map(r => renderRow(r)),
                    <tr key={`wtotal-${week}`} className="border-b border-white/[0.06] bg-white/[0.01]">
                      <td colSpan={6} className="px-3 py-1.5">
                        <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Total semana {week}</span>
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono font-semibold text-right text-emerald-400 whitespace-nowrap">
                        {wFact > 0 ? formatCurrency(wFact) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono font-semibold text-right text-emerald-300 whitespace-nowrap">
                        {wUp > 0 ? formatCurrency(wUp) : '—'}
                      </td>
                      <td colSpan={2} />
                    </tr>,
                  ]
                })
              )}
              {records.length > 0 && (
                <tr className="border-t border-white/[0.1] bg-white/[0.02]">
                  <td colSpan={5} className="px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Total Mes · {grandCierres} cierre{grandCierres !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td />
                  <td className="px-2 py-2 text-xs font-mono font-bold text-right text-emerald-400 whitespace-nowrap">
                    {formatCurrency(grandFact)}
                  </td>
                  <td className="px-2 py-2 text-xs font-mono font-bold text-right text-emerald-300 whitespace-nowrap">
                    {formatCurrency(grandUpfront)}
                  </td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">Click en cualquier celda para editar · Los cambios se guardan al confirmar · <Maximize2 className="h-2.5 w-2.5 inline" /> para ver todos los campos</p>

      {expandedId && (
        <AgendaRecordModal
          key={expandedId}
          record={records.find(r => r.id === expandedId)!}
          avatarList={avatarList}
          onClose={() => setExpandedId(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
