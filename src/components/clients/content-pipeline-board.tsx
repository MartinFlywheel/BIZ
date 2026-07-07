'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, GripVertical, X, Check } from 'lucide-react'
import {
  getPipelineItems,
  createPipelineItem,
  updatePipelineItem,
  deletePipelineItem,
  type PipelineItem,
  type PipelineStage,
} from '@/lib/actions/content-pipeline'
import { CardDetailDrawer } from './card-detail-drawer'

// ── Column config ────────────────────────────────────────────────────────────

const STAGES: { id: PipelineStage; label: string; color: string; dot: string }[] = [
  { id: 'ideas',        label: 'Ideas',        color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',        dot: 'bg-zinc-400' },
  { id: 'grabar',       label: 'Grabar',       color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',  dot: 'bg-orange-400' },
  { id: 'grabados',     label: 'Grabados',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',        dot: 'bg-blue-400' },
  { id: 'editados',     label: 'Editados',     color: 'bg-violet-500/20 text-violet-300 border-violet-500/30',  dot: 'bg-violet-400' },
  { id: 'por_publicar', label: 'Por Publicar', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',     dot: 'bg-amber-400' },
  { id: 'publicados',   label: 'Publicados',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
]

// ── Card ─────────────────────────────────────────────────────────────────────

function KanbanCard({
  item,
  clientId,
  onOpen,
  onMoved,
  onDeleted,
}: {
  item: PipelineItem
  clientId: string
  onOpen: () => void
  onMoved: (id: string, stage: PipelineStage) => void
  onDeleted: (id: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const wasDragged = useRef(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    await deletePipelineItem(item.id, clientId)
    onDeleted(item.id)
  }

  const stageIdx = STAGES.findIndex((s) => s.id === item.stage)
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null
  const prevStage = stageIdx > 0 ? STAGES[stageIdx - 1] : null

  async function moveToStage(e: React.MouseEvent, stage: PipelineStage) {
    e.stopPropagation()
    await updatePipelineItem(item.id, clientId, { stage })
    onMoved(item.id, stage)
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('itemId', item.id)
        e.dataTransfer.setData('fromStage', item.stage)
        wasDragged.current = true
        setDragging(true)
      }}
      onDragEnd={() => {
        setDragging(false)
        // Reset after click handler fires (which fires after dragend)
        setTimeout(() => { wasDragged.current = false }, 50)
      }}
      onClick={() => {
        if (!wasDragged.current) onOpen()
      }}
      className={`group relative rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 transition-all cursor-pointer
        ${dragging ? 'opacity-40 scale-95' : 'hover:bg-white/[0.06] hover:border-white/[0.1]'}`}
    >
      {/* Drag handle */}
      <GripVertical className="absolute left-1.5 top-3 h-3 w-3 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Title */}
      <div className="pl-3">
        <p className="text-xs text-zinc-200 leading-snug">{item.title}</p>
        {/* Metadata pills */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {item.angle && (
            <span className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-px text-[9px] text-zinc-500">
              {item.angle}
            </span>
          )}
          {item.assigned_to && (
            <span className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-px text-[9px] text-zinc-500">
              {item.assigned_to}
            </span>
          )}
          {item.due_date && (
            <span className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-px text-[9px] text-zinc-500 tabular-nums">
              {new Date(item.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>

      {/* Action row — visible on hover */}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity pl-3">
        {prevStage && (
          <button
            onClick={(e) => moveToStage(e, prevStage.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
          >
            ← {prevStage.label}
          </button>
        )}
        {nextStage && (
          <button
            onClick={(e) => moveToStage(e, nextStage.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
          >
            {nextStage.label} →
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={handleDelete}
          className="rounded p-0.5 text-zinc-700 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  items,
  clientId,
  onOpen,
  onMoved,
  onDeleted,
  onAdded,
}: {
  stage: typeof STAGES[number]
  items: PipelineItem[]
  clientId: string
  onOpen: (item: PipelineItem) => void
  onMoved: (id: string, toStage: PipelineStage, fromStage: PipelineStage) => void
  onDeleted: (id: string, stage: PipelineStage) => void
  onAdded: (item: PipelineItem) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) addInputRef.current?.focus() }, [adding])

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const itemId = e.dataTransfer.getData('itemId')
    const fromStage = e.dataTransfer.getData('fromStage') as PipelineStage
    if (!itemId || fromStage === stage.id) return
    await updatePipelineItem(itemId, clientId, { stage: stage.id })
    onMoved(itemId, stage.id, fromStage)
  }

  async function handleAdd() {
    const trimmed = newTitle.trim()
    if (!trimmed) { setAdding(false); return }
    await createPipelineItem(clientId, trimmed, stage.id)
    onAdded({
      id: crypto.randomUUID(),
      client_id: clientId,
      title: trimmed,
      description: null,
      script: null,
      reference_url: null,
      assigned_to: null,
      due_date: null,
      angle: null,
      stage: stage.id,
      position: items.length,
      created_at: new Date().toISOString(),
    })
    setNewTitle('')
    setAdding(false)
  }

  return (
    <div
      className={`flex flex-col gap-2 min-w-[220px] max-w-[220px] rounded-xl border transition-colors
        ${dragOver ? 'border-white/[0.15] bg-white/[0.04]' : 'border-white/[0.06] bg-white/[0.02]'}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${stage.color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} />
            {stage.label}
          </span>
          <span className="text-[11px] text-zinc-600 font-mono">{items.length}</span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-md p-1 text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 px-2 pb-2 min-h-[80px]">
        {items.map((item) => (
          <KanbanCard
            key={item.id}
            item={item}
            clientId={clientId}
            onOpen={() => onOpen(item)}
            onMoved={(id, toStage) => onMoved(id, toStage, stage.id)}
            onDeleted={(id) => onDeleted(id, stage.id)}
          />
        ))}

        {/* Add card inline */}
        {adding ? (
          <div className="rounded-lg border border-white/[0.1] bg-white/[0.04] p-2.5 space-y-2">
            <input
              ref={addInputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setNewTitle(''); setAdding(false) }
              }}
              placeholder="Título del reel..."
              className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <div className="flex gap-1">
              <button
                onClick={handleAdd}
                className="flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/[0.12] transition-colors"
              >
                <Check className="h-3 w-3" /> Agregar
              </button>
              <button
                onClick={() => { setNewTitle(''); setAdding(false) }}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/[0.06] px-3 py-2 text-[11px] text-zinc-700 hover:border-white/[0.12] hover:text-zinc-500 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Nueva idea
          </button>
        )}
      </div>
    </div>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function ContentPipelineBoard({ clientId }: { clientId: string }) {
  const [columns, setColumns] = useState<Record<PipelineStage, PipelineItem[]>>({
    ideas: [], grabar: [], grabados: [], editados: [], por_publicar: [], publicados: [],
  })
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null)

  useEffect(() => {
    getPipelineItems(clientId).then((data) => {
      setColumns(data)
      setLoading(false)
    })
  }, [clientId])

  function handleMoved(id: string, toStage: PipelineStage, fromStage: PipelineStage) {
    setColumns((prev) => {
      const item = prev[fromStage].find((i) => i.id === id)
      if (!item) return prev
      return {
        ...prev,
        [fromStage]: prev[fromStage].filter((i) => i.id !== id),
        [toStage]: [{ ...item, stage: toStage }, ...prev[toStage]],
      }
    })
  }

  function handleDeleted(id: string, stage: PipelineStage) {
    setColumns((prev) => ({
      ...prev,
      [stage]: prev[stage].filter((i) => i.id !== id),
    }))
    setSelectedItem((prev) => prev?.id === id ? null : prev)
  }

  function handleAdded(stage: PipelineStage, item: PipelineItem) {
    setColumns((prev) => ({
      ...prev,
      [stage]: [...prev[stage], item],
    }))
  }

  function handleItemUpdated(updates: Partial<PipelineItem>) {
    if (!selectedItem) return
    const fromStage = selectedItem.stage
    const toStage = (updates.stage as PipelineStage | undefined) ?? fromStage

    setColumns((prev) => {
      if (updates.stage && updates.stage !== fromStage) {
        const item = prev[fromStage].find((i) => i.id === selectedItem.id)
        if (!item) return prev
        return {
          ...prev,
          [fromStage]: prev[fromStage].filter((i) => i.id !== selectedItem.id),
          [toStage]: [{ ...item, ...updates }, ...prev[toStage]],
        }
      }
      return {
        ...prev,
        [fromStage]: prev[fromStage].map((i) =>
          i.id === selectedItem.id ? { ...i, ...updates } : i
        ),
      }
    })

    setSelectedItem((prev) => prev ? { ...prev, ...updates } : prev)
  }

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => (
          <div key={s.id} className="min-w-[220px] h-48 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            items={columns[stage.id]}
            clientId={clientId}
            onOpen={(item) => setSelectedItem(item)}
            onMoved={handleMoved}
            onDeleted={handleDeleted}
            onAdded={(item) => handleAdded(stage.id, item)}
          />
        ))}
      </div>

      {selectedItem && (
        <CardDetailDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={handleItemUpdated}
        />
      )}
    </>
  )
}
