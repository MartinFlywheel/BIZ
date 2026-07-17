'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Calendar, Tag, User, FileText, Mic, Play, Pause, Square, Trash2, RotateCcw, Video, Film, Heading, Bold, Eraser } from 'lucide-react'
import { updatePipelineItem, type PipelineItem, type PipelineStage } from '@/lib/actions/content-pipeline'
import { createClient } from '@/lib/supabase/client'

const STAGES: { id: PipelineStage; label: string; color: string; dot: string }[] = [
  { id: 'ideas',        label: 'Ideas',        color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',       dot: 'bg-zinc-400' },
  { id: 'grabar',       label: 'Grabar',       color: 'bg-orange-500/20 text-orange-300 border-orange-500/30', dot: 'bg-orange-400' },
  { id: 'grabados',     label: 'Grabados',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       dot: 'bg-blue-400' },
  { id: 'editados',     label: 'Editados',     color: 'bg-violet-500/20 text-violet-300 border-violet-500/30', dot: 'bg-violet-400' },
  { id: 'por_publicar', label: 'Por Publicar', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',    dot: 'bg-amber-400' },
  { id: 'publicados',   label: 'Publicados',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
]

const ANGLES = ['Clientes', 'Educativo', 'Viral', 'Nutrición', 'Casos de éxito', 'Posicionamiento', 'Dolor', 'Autoridad']

// ── Shared time formatter ─────────────────────────────────────────────────────

function fmt(s: number) {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayer({ src, onDelete, onReRecord }: { src: string; onDelete: () => void; onReRecord: () => void }) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { audio.play(); setPlaying(true) }
  }

  const progress = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="shrink-0 h-9 w-9 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors"
        >
          {playing
            ? <Pause className="h-3.5 w-3.5 text-white" />
            : <Play className="h-3.5 w-3.5 text-white translate-x-px" />
          }
        </button>

        <div className="flex-1 space-y-1">
          {/* Waveform-style progress bar */}
          <div className="relative h-1.5 bg-white/[0.08] rounded-full">
            <div
              className="absolute left-0 top-0 h-full bg-zinc-400 rounded-full pointer-events-none transition-all"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.01}
              value={currentTime}
              onChange={(e) => {
                const t = Number(e.target.value)
                if (audioRef.current) audioRef.current.currentTime = t
                setCurrentTime(t)
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-zinc-600 font-mono tabular-nums">{fmt(currentTime)}</span>
            <span className="text-[10px] text-zinc-600 font-mono tabular-nums">{fmt(duration)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onReRecord} className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors">
          <RotateCcw className="h-3 w-3" /> Regrabar
        </button>
        <button onClick={onDelete} className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-red-400 transition-colors">
          <Trash2 className="h-3 w-3" /> Eliminar
        </button>
      </div>
    </div>
  )
}

// ── Link field (Referencia / Crudo / Editado) ───────────────────────────────

function LinkField({ icon: Icon, label, value, placeholder, onChange }: {
  icon: React.ElementType
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[11px] text-zinc-400 outline-none placeholder:text-zinc-700 font-mono"
        />
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-zinc-600 hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}

// ── Script editor — lightweight rich text (headings + bold) via
// contentEditable/execCommand, no external editor dependency ────────────────

function ScriptEditor({ initialValue, onChange }: { initialValue: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null)

  // Set the starting content once, imperatively — never again from a prop
  // change. Re-applying innerHTML from React on every keystroke (the
  // previous dangerouslySetInnerHTML wiring) reset the caret to position 0
  // after every character, which is what made typing look reversed.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialValue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function exec(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden focus-within:border-white/[0.1] transition-colors">
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <button
          type="button"
          title="Título"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('formatBlock', 'h3')}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
        >
          <Heading className="h-3 w-3" /> Título
        </button>
        <button
          type="button"
          title="Negrita"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
        >
          <Bold className="h-3 w-3" /> Negrita
        </button>
        <button
          type="button"
          title="Quitar formato"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('removeFormat')}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
        >
          <Eraser className="h-3 w-3" /> Normal
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        data-placeholder="Escribe el guión, notas o ideas para el reel..."
        className="min-h-[240px] px-3 py-3 text-[12px] text-zinc-300 outline-none leading-relaxed
          empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-700
          [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:first:mt-0
          [&_strong]:text-zinc-100 [&_strong]:font-semibold"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  item: PipelineItem
  onClose: () => void
  onUpdated: (updates: Partial<PipelineItem>) => void
}

export function CardDetailDrawer({ item, onClose, onUpdated }: Props) {
  const [title, setTitle]           = useState(item.title)
  const [script, setScript]         = useState(item.script ?? '')
  const [referenceUrl, setRef]      = useState(item.reference_url ?? '')
  const [rawVideoUrl, setRawVideo]     = useState(item.raw_video_url ?? '')
  const [editedVideoUrl, setEditedVideo] = useState(item.edited_video_url ?? '')
  const [assignedTo, setAssigned]   = useState(item.assigned_to ?? '')
  const [dueDate, setDueDate]       = useState(item.due_date ?? '')
  const [angle, setAngle]           = useState(item.angle ?? '')
  const [audioUrl, setAudioUrl]     = useState(item.audio_url ?? null)
  const [recording, setRecording]   = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [uploading, setUploading]   = useState(false)
  const mediaRecRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)
  const [stage, setStage]           = useState<PipelineStage>(item.stage)
  const [stageOpen, setStageOpen]   = useState(false)
  const [angleOpen, setAngleOpen]   = useState(false)
  const [angleCustom, setAngleCustom] = useState('')
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Parameters<typeof updatePipelineItem>[2]>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Flush any pending save immediately when drawer closes
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        const pending = pendingRef.current
        if (Object.keys(pending).length > 0) {
          updatePipelineItem(item.id, item.client_id, pending)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.client_id])

  // Sync if parent item changes (e.g. stage moved from board)
  useEffect(() => {
    setStage(item.stage)
  }, [item.stage])

  const debounceSave = useCallback((fields: Parameters<typeof updatePipelineItem>[2]) => {
    // Accumulate all pending changes — don't overwrite previous field updates
    pendingRef.current = { ...pendingRef.current, ...fields }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const toSave = pendingRef.current
      pendingRef.current = {}
      await updatePipelineItem(item.id, item.client_id, toSave)
      onUpdated(toSave as Partial<PipelineItem>)
    }, 800)
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

  async function uploadBlob(blob: Blob) {
    setUploading(true)
    try {
      const supabase = createClient()
      const path = `${item.client_id}/${item.id}.webm`
      const { error } = await supabase.storage
        .from('pipeline-audio')
        .upload(path, blob, { contentType: 'audio/webm', upsert: true })
      if (error) {
        alert(`Error al guardar el audio: ${error.message}\n\nAsegurate de crear el bucket "pipeline-audio" en Supabase → Storage.`)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('pipeline-audio').getPublicUrl(path)
      await updatePipelineItem(item.id, item.client_id, { audio_url: publicUrl })
      setAudioUrl(publicUrl)
      onUpdated({ audio_url: publicUrl })
    } finally {
      setUploading(false)
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecRef.current = mr
      chunksRef.current = []
      cancelledRef.current = false

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (cancelledRef.current) return
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        uploadBlob(blob)
      }

      mr.start()
      setRecording(true)
      setRecSeconds(0)
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    } catch {
      alert('No se pudo acceder al micrófono. Verificá los permisos del navegador.')
    }
  }

  function stopRecording() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecRef.current?.stop()
    setRecording(false)
  }

  function cancelRecording() {
    cancelledRef.current = true
    stopRecording()
    setRecSeconds(0)
  }

  async function handleAudioDelete() {
    const supabase = createClient()
    const path = audioUrl?.split('/pipeline-audio/')[1]
    if (path) await supabase.storage.from('pipeline-audio').remove([path])
    await updatePipelineItem(item.id, item.client_id, { audio_url: null })
    setAudioUrl(null)
    onUpdated({ audio_url: null })
  }

  const currentStage = STAGES.find((s) => s.id === stage)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return createPortal(
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

          {/* ── Links: Referencia / Crudo / Editado ── */}
          <LinkField
            icon={ExternalLink}
            label="Referencia"
            value={referenceUrl}
            placeholder="https://www.instagram.com/reel/..."
            onChange={(v) => { setRef(v); debounceSave({ reference_url: v }) }}
          />
          <LinkField
            icon={Video}
            label="Crudo"
            value={rawVideoUrl}
            placeholder="Link al video sin editar (Drive, etc.)..."
            onChange={(v) => { setRawVideo(v); debounceSave({ raw_video_url: v }) }}
          />
          <LinkField
            icon={Film}
            label="Editado"
            value={editedVideoUrl}
            placeholder="Link al video ya editado..."
            onChange={(v) => { setEditedVideo(v); debounceSave({ edited_video_url: v }) }}
          />

          {/* ── Audio ── */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold flex items-center gap-1.5">
              <Mic className="h-3 w-3" /> Audio
            </p>

            {audioUrl ? (
              <AudioPlayer
                src={audioUrl}
                onDelete={handleAudioDelete}
                onReRecord={() => { handleAudioDelete(); }}
              />
            ) : recording ? (
              /* ── Recording in progress ── */
              <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="flex-1 text-[13px] text-red-400 font-mono tabular-nums">{fmt(recSeconds)}</span>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] px-3 py-1.5 text-[11px] text-zinc-200 transition-colors"
                >
                  <Square className="h-3 w-3 fill-current" /> Enviar
                </button>
                <button
                  onClick={cancelRecording}
                  className="rounded-lg px-2 py-1.5 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : uploading ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="h-3 w-3 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
                <span className="text-[12px] text-zinc-600">Guardando audio...</span>
              </div>
            ) : (
              /* ── Idle ── */
              <button
                onClick={startRecording}
                className="w-full flex items-center gap-3 rounded-xl border border-dashed border-white/[0.06] px-4 py-3 hover:border-white/[0.1] hover:bg-white/[0.02] transition-colors group"
              >
                <div className="h-8 w-8 rounded-full bg-white/[0.05] group-hover:bg-white/[0.08] flex items-center justify-center transition-colors shrink-0">
                  <Mic className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                </div>
                <span className="text-[12px] text-zinc-600 group-hover:text-zinc-400 transition-colors">
                  Grabar nota de voz
                </span>
              </button>
            )}
          </div>

          {/* ── Script ── */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Script
            </p>
            <ScriptEditor
              initialValue={script}
              onChange={(html) => { setScript(html); debounceSave({ script: html }) }}
            />
          </div>

        </div>
      </div>
    </>,
    document.body
  )
}
