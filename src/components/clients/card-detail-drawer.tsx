'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ExternalLink, Calendar, Tag, User, FileText } from 'lucide-react'
import { updatePipelineItem, type PipelineItem, type PipelineStage } from '@/lib/actions/content-pipeline'

const STAGES: { id: PipelineStage; label: string; color: string; dot: string }[] = [
  { id: 'ideas',        label: 'Ideas',        color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',       dot: 'bg-zinc-400' },
  { id: 'grabar',       label: 'Grabar',       color: 'bg-orange-500/20 text-orange-300 border-orange-500/30', dot: 'bg-orange-400' },
  { id: 'grabados',     label: 'Grabados',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       dot: 'bg-blue-400' },
  { id: 'editados',     label: 'Editados',     color: 'bg-violet-500/20 text-violet-300 border-violet-500/30', dot: 'bg-violet-400' },
  { id: 'por_publicar', label: 'Por Publicar', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',    dot: 'bg-amber-400' },
  { id: 'publicados',   label: 'Publicados',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
]

const ANGLES = ['Clientes', 'Educativo', 'Viral', 'Nutrición', 'Casos de éxito', 'Posicionamiento', 'Dolor', 'Autoridad']

interface Props {
  item: PipelineItem
  onClose: () => void
  onUpdated: (updates: Partial<PipelineItem>) => void
}

export function CardDetailDrawer({ item, onClose, onUpdated }: Props) {
  const [title, setTitle]           = useState(item.title)
  const [script, setScript]         = useState(item.script ?? '')
  const [referenceUrl, setRef]      = useState(item.reference_url ?? '')
  const [assignedTo, setAssigned]   = useState(item.assigned_to ?? '')
  const [dueDate, setDueDate]       = useState(item.due_date ?? '')
  const [angle, setAngle]           = useState(item.angle ?? '')
  const [stage, setStage]           = useState<PipelineStage>(item.stage)
  const [stageOpen, setStageOpen]   = useState(false)
  const [angleOpen, setAngleOpen]   = useState(false)
  const [angleCustom, setAngleCustom] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Sync if parent item changes (e.g. stage moved from board)
  useEffect(() => {
    setStage(item.stage)
  }, [item.stage])

  const debounceSave = useCallback((fields: Parameters<typeof updatePipelineItem>[2]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await updatePipelineItem(item.id, item.client_id, fields)
      onUpdated(fields as Partial<PipelineItem>)
    }, 500)
  }, [item.id, item.client_id, onUpdated])

  async function changeStage(s: PipelineStage) {
    setStage(s)
    setStageOpen(false)
    await updatePipelineItem(item.id, item.client_id, { stage: s })
    onUpdated({ stage: s })
  }

  function selectAngle(a: string) {
    setAngle(a)
    setAngleOpen(false)
    debounceSave({ angle: a })
  }

  const currentStage = STAGES.find((s) => s.id === stage)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[480px] max-w-[95vw] bg-[#0a0a0a] border-l border-white/[0.07] shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">Detalle del reel</span>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {/* ── Title ── */}
          <textarea
            value={title}
            onChange={(e) => { setTitle(e.target.value); debounceSave({ title: e.target.value }) }}
            placeholder="Título del reel..."
            rows={2}
            className="w-full bg-transparent text-[22px] font-semibold text-zinc-50 outline-none resize-none placeholder:text-zinc-700 leading-snug"
          />

          {/* ── Properties ── */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.04]">

            {/* Stage */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0">Estado</span>
              <div className="relative">
                <button
                  onClick={() => { setStageOpen(!stageOpen); setAngleOpen(false) }}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 ${currentStage?.color}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${currentStage?.dot}`} />
                  {currentStage?.label}
                </button>
                {stageOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-10 rounded-xl border border-white/[0.08] bg-zinc-900 shadow-2xl py-1.5 min-w-[160px]">
                    {STAGES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => changeStage(s.id)}
                        className="w-full flex items-center px-3 py-1.5 hover:bg-white/[0.04] transition-colors"
                      >
                        <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${s.color} ${s.id === stage ? 'opacity-40' : ''}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Assigned */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0 flex items-center gap-1.5">
                <User className="h-3 w-3" /> Asignado
              </span>
              <input
                value={assignedTo}
                onChange={(e) => { setAssigned(e.target.value); debounceSave({ assigned_to: e.target.value }) }}
                placeholder="—"
                className="flex-1 bg-transparent text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700"
              />
            </div>

            {/* Due date */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> Fecha
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => { setDueDate(e.target.value); debounceSave({ due_date: e.target.value || null }) }}
                className="flex-1 bg-transparent text-[12px] text-zinc-300 outline-none [color-scheme:dark]"
              />
            </div>

            {/* Angle */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0 flex items-center gap-1.5">
                <Tag className="h-3 w-3" /> Ángulo
              </span>
              <div className="relative flex-1">
                <button
                  onClick={() => { setAngleOpen(!angleOpen); setStageOpen(false) }}
                  className="text-[12px] text-zinc-300 hover:text-zinc-100 transition-colors text-left"
                >
                  {angle
                    ? <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px]">{angle}</span>
                    : <span className="text-zinc-700">—</span>
                  }
                </button>
                {angleOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-10 rounded-xl border border-white/[0.08] bg-zinc-900 shadow-2xl py-1.5 min-w-[190px]">
                    {ANGLES.map((a) => (
                      <button
                        key={a}
                        onClick={() => selectAngle(a)}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/[0.05] transition-colors ${a === angle ? 'text-zinc-100' : 'text-zinc-400'}`}
                      >
                        {a}
                      </button>
                    ))}
                    <div className="border-t border-white/[0.05] mt-1 pt-1 px-2">
                      <input
                        value={angleCustom}
                        onChange={(e) => setAngleCustom(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && angleCustom.trim()) selectAngle(angleCustom.trim())
                          if (e.key === 'Escape') setAngleOpen(false)
                        }}
                        placeholder="Personalizado + Enter..."
                        className="w-full py-1.5 text-[11px] bg-transparent text-zinc-400 outline-none placeholder:text-zinc-700"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Reference URL ── */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold flex items-center gap-1.5">
              <ExternalLink className="h-3 w-3" /> Referencia
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <input
                value={referenceUrl}
                onChange={(e) => { setRef(e.target.value); debounceSave({ reference_url: e.target.value }) }}
                placeholder="https://www.instagram.com/reel/..."
                className="flex-1 bg-transparent text-[11px] text-zinc-400 outline-none placeholder:text-zinc-700 font-mono"
              />
              {referenceUrl && (
                <a
                  href={referenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-zinc-600 hover:text-blue-400 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* ── Script ── */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Script
            </p>
            <textarea
              value={script}
              onChange={(e) => { setScript(e.target.value); debounceSave({ script: e.target.value }) }}
              placeholder="Escribe el guión, notas o ideas para el reel..."
              rows={12}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-700 resize-none leading-relaxed focus:border-white/[0.1] transition-colors"
            />
          </div>

        </div>
      </div>
    </>
  )
}
