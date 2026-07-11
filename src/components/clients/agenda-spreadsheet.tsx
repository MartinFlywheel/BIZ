'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, X, ExternalLink, Loader2 } from 'lucide-react'
import {
  getAgendaRecords, createAgendaRecord, updateAgendaRecord, deleteAgendaRecord,
  type AgendaRecord, type AgendaRecordFields,
} from '@/lib/actions/agenda-records'
import { LEAD_AVATARS } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ESTADO_OPTIONS = ['Show','No Show','Cerrado','No Calificado','Reagendado','Pendiente']
const FORMA_CIERRE_OPTIONS = ['1 cuota','2 cuotas','3 cuotas','Pago completo','Otra']

const estadoColor: Record<string, string> = {
  'Show':           'text-emerald-400',
  'Cerrado':        'text-emerald-300 font-semibold',
  'No Show':        'text-red-400',
  'No Calificado':  'text-zinc-500',
  'Reagendado':     'text-amber-400',
  'Pendiente':      'text-blue-400',
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

// ── Small UI primitives ───────────────────────────────────────────────────────

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

// ── AgendaRecordModal ─────────────────────────────────────────────────────────

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

        <SectionHead>Lead</SectionHead>
        <Field label="Nombre">
          <input className={inputCls} value={local.nombre_lead ?? ''} placeholder="Nombre del lead"
            onChange={e => set('nombre_lead', e.target.value || null)} />
        </Field>
        <Field label="Avatar">
          <select className={selectCls} value={local.avatar ?? ''} onChange={e => set('avatar', e.target.value || null)}>
            <option value="">Sin avatar</option>
            {avatarList.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <LinkField label="Link al perfil" field="link_perfil" />

        <SectionHead>Fuente y Contacto</SectionHead>
        <Field label="Fecha 1er contacto">
          <input type="date" className={inputCls + ' [color-scheme:dark]'} value={local.fecha_1er_contacto ?? ''}
            onChange={e => set('fecha_1er_contacto', e.target.value || null)} />
        </Field>
        <Field label="De donde vino (último CTA)">
          <input className={inputCls} value={local.de_donde_vino ?? ''} placeholder="Reel, Historia, DM..."
            onChange={e => set('de_donde_vino', e.target.value || null)} />
        </Field>
        <Field label="1er CTA">
          <input className={inputCls} value={local.primer_cta ?? ''} placeholder="Primer punto de contacto"
            onChange={e => set('primer_cta', e.target.value || null)} />
        </Field>
        <Field label="Tiempo de compra">
          <div className="flex h-[34px] items-center px-3 rounded-lg border border-zinc-800 bg-zinc-900 text-sm text-zinc-400 font-mono">{tiempo}</div>
        </Field>
        <Field label="Todos los contactos (CTAs)" full>
          <input className={inputCls} value={local.todos_los_ctas ?? ''} placeholder="Lista de todos los CTAs del lead"
            onChange={e => set('todos_los_ctas', e.target.value || null)} />
        </Field>

        <SectionHead>Llamada</SectionHead>
        <Field label="Fecha de agenda">
          <input type="date" className={inputCls + ' [color-scheme:dark]'} value={local.fecha_agenda ?? ''}
            onChange={e => set('fecha_agenda', e.target.value || null)} />
        </Field>
        <Field label="Closer">
          <input className={inputCls} value={local.closer ?? ''} placeholder="Nombre del closer"
            onChange={e => set('closer', e.target.value || null)} />
        </Field>
        <LinkField label="Link a la reunión" field="link_reunion" />
        <LinkField label="Link al reporte" field="link_reporte" />

        <SectionHead>Resultado</SectionHead>
        <Field label="Estado">
          <select className={selectCls} value={local.estado ?? ''} onChange={e => set('estado', e.target.value || null)}>
            <option value="">Sin estado</option>
            {ESTADO_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
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
        <Field label="Monto Facturación">
          <input type="number" className={inputCls} value={local.monto_facturacion ?? ''} placeholder="0"
            onChange={e => set('monto_facturacion', e.target.value ? +e.target.value : null)} />
        </Field>
        <Field label="Monto Upfront">
          <input type="number" className={inputCls} value={local.monto_upfront ?? ''} placeholder="0"
            onChange={e => set('monto_upfront', e.target.value ? +e.target.value : null)} />
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

// ── Main component ────────────────────────────────────────────────────────────

const HEADERS = [
  'Fecha', 'Nombre', 'Avatar', 'CTA', 'Closer', 'Estado',
  'Facturación', 'Upfront', 'T. Compra', '',
]

export function AgendaSpreadsheet({ clientId, customAvatars }: { clientId: string; customAvatars?: string[] }) {
  const avatarList: readonly string[] = customAvatars && customAvatars.length > 0 ? customAvatars : LEAD_AVATARS
  const now = new Date()
  const [year, setYear]     = useState(now.getFullYear())
  const [month, setMonth]   = useState(now.getMonth() + 1)
  const [records, setRecords] = useState<AgendaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AgendaRecord | null>(null)

  async function load() {
    setLoading(true)
    try { setRecords(await getAgendaRecords(clientId, year, month)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [clientId, year, month])

  async function handleAdd() {
    const today = new Date()
    const fecha = (year === today.getFullYear() && month === today.getMonth() + 1)
      ? today.toISOString().split('T')[0]
      : `${year}-${String(month).padStart(2, '0')}-01`
    const created = await createAgendaRecord(clientId, { fecha_agenda: fecha })
    setRecords(prev => [...prev, created].sort((a, b) => (a.fecha_agenda ?? '').localeCompare(b.fecha_agenda ?? '')))
    setEditing(created)
  }

  function handleUpdated(id: string, fields: AgendaRecordFields) {
    setRecords(prev =>
      prev.map(r => r.id === id ? { ...r, ...fields } : r)
          .sort((a, b) => (a.fecha_agenda ?? '').localeCompare(b.fecha_agenda ?? ''))
    )
  }

  function handleDeleted(id: string) {
    setRecords(prev => prev.filter(r => r.id !== id))
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />
        <button onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors">
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
                <>
                  {Array.from(weeks.entries()).sort(([a], [b]) => a - b).map(([week, recs]) => {
                    const wFact = recs.reduce((s, r) => s + (r.monto_facturacion ?? 0), 0)
                    const wUp   = recs.reduce((s, r) => s + (r.monto_upfront ?? 0), 0)
                    return (
                      <tbody key={week}>
                        {/* Week label */}
                        <tr className="bg-white/[0.015]">
                          <td colSpan={HEADERS.length} className="px-3 py-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Semana {week}</span>
                          </td>
                        </tr>

                        {/* Records */}
                        {recs.map(r => (
                          <tr key={r.id} onClick={() => setEditing(r)}
                            className="group border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors">
                            <td className="px-2 py-2 text-xs text-zinc-300 whitespace-nowrap">{fmtDate(r.fecha_agenda)}</td>
                            <td className="px-2 py-2 text-xs text-zinc-100 max-w-[140px] truncate">{r.nombre_lead || '—'}</td>
                            <td className="px-2 py-2 text-xs text-zinc-400 whitespace-nowrap">{r.avatar || '—'}</td>
                            <td className="px-2 py-2 text-xs text-zinc-500 max-w-[120px] truncate">{r.de_donde_vino || '—'}</td>
                            <td className="px-2 py-2 text-xs text-zinc-400 whitespace-nowrap">{r.closer || '—'}</td>
                            <td className="px-2 py-2 text-xs whitespace-nowrap">
                              <span className={estadoColor[r.estado ?? ''] ?? 'text-zinc-500'}>{r.estado || '—'}</span>
                            </td>
                            <td className="px-2 py-2 text-xs font-mono text-right text-zinc-200 whitespace-nowrap">
                              {r.monto_facturacion ? formatCurrency(r.monto_facturacion) : '—'}
                            </td>
                            <td className="px-2 py-2 text-xs font-mono text-right text-zinc-400 whitespace-nowrap">
                              {r.monto_upfront ? formatCurrency(r.monto_upfront) : '—'}
                            </td>
                            <td className="px-2 py-2 text-xs font-mono text-right text-zinc-600 whitespace-nowrap">
                              {tiempoDeCompra(r.fecha_agenda, r.fecha_1er_contacto)}
                            </td>
                            <td className="px-2 py-2">
                              <button onClick={e => handleDeleteRow(r.id, e)}
                                className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 transition-all">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}

                        {/* Week total */}
                        <tr className="border-b border-white/[0.06] bg-white/[0.01]">
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
                        </tr>
                      </tbody>
                    )
                  })}

                  {/* Grand total */}
                  <tbody>
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
                  </tbody>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">Click en un lead para editar todos los campos · Los cambios se guardan automáticamente</p>

      {editing && (
        <AgendaRecordModal
          key={editing.id}
          record={records.find(r => r.id === editing.id) ?? editing}
          avatarList={avatarList}
          onClose={() => setEditing(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
