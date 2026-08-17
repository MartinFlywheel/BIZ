'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
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
import { objectiveColor } from '@/lib/types'

// ── Column config ────────────────────────────────────────────────────────────

const STAGES: { id: PipelineStage; label: string; color: string; dot: string }[] = [
  { id: 'ideas',        label: 'Ideas',        color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',        dot: 'bg-zinc-400' },
  { id: 'grabar',       label: 'Grabar',       color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',  dot: 'bg-orange-400' },
  { id: 'grabados',     label: 'Grabados',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',        dot: 'bg-blue-400' },
  { id: 'editados',     label: 'Editados',     color: 'bg-violet-500/20 text-violet-300 border-violet-500/30',  dot: 'bg-violet-400' },
  { id: 'por_publicar', label: 'Por Publicar', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',     dot: 'bg-amber-400' },
  { id: 'publicados',   label: 'Publicados',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
]

function isTempId(id: string) {
  return id.startsWith('temp-')
}

// ── Card ─────────────────────────────────────────────────────────────────────

function KanbanCard({
  item,
  onOpen,
  onMoved,
  onDeleted,
}: {
  item: PipelineItem
  onOpen: () => void
  onMoved: (id: string, stage: PipelineStage) => void
  onDeleted: (id: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const wasDragged = useRef(false)

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    onDeleted(item.id)
  }

  const stageIdx = STAGES.findIndex((s) => s.id === item.stage)
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null
  const prevStage = stageIdx > 0 ? STAGES[stageIdx - 1] : null

  function moveToStage(e: React.MouseEvent, stage: PipelineStage) {
    e.stopPropagation()
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
          {item.objective && (() => {
            const c = objectiveColor(item.objective)
            return (
              <span className={`rounded border ${c.border} ${c.bg} px-1.5 py-px text-[9px] font-medium ${c.text}`}>
                {item.objective}
              </span>
            )
          })()}
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
  onOpen,
  onReorder,
  onDeleted,
  onAdd,
}: {
  stage: typeof STAGES[number]
  items: PipelineItem[]
  onOpen: (item: PipelineItem) => void
  onReorder: (id: string, toStage: PipelineStage, fromStage: PipelineStage, toIndex: number) => void
  onDeleted: (id: string, stage: PipelineStage) => void
  onAdd: (stage: PipelineStage, title: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) addInputRef.current?.focus() }, [adding])

  // Se fija en el punto medio vertical de cada tarjeta para decidir si la
  // que se está arrastrando entraría antes o después de ella — así el
  // usuario suelta "por encima o por debajo" de una tarjeta puntual en vez
  // de solo poder mandarla al tope de la columna.
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
    const cardEls = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-kanban-index]')
    let index = items.length
    for (const el of Array.from(cardEls)) {
      const rect = el.getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) {
        index = Number(el.dataset.kanbanIndex)
        break
      }
    }
    setDropIndex(index)
  }

  function handleDragLeave(e: React.DragEvent) {
    // dragleave dispara también al pasar a una tarjeta hija — si el mouse
    // sigue dentro de la columna, ignorarlo evita que el indicador titile.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
    setDropIndex(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('itemId')
    const fromStage = e.dataTransfer.getData('fromStage') as PipelineStage
    const targetIndex = dropIndex ?? items.length
    setDragOver(false)
    setDropIndex(null)
    if (!itemId) return
    onReorder(itemId, stage.id, fromStage, targetIndex)
  }

  function handleAdd() {
    const trimmed = newTitle.trim()
    if (!trimmed) { setAdding(false); return }
    setNewTitle('')
    setAdding(false)
    onAdd(stage.id, trimmed)
  }

  return (
    <div
      className={`flex flex-col gap-2 min-w-[220px] max-w-[220px] rounded-xl border transition-colors
        ${dragOver ? 'border-white/[0.15] bg-white/[0.04]' : 'border-white/[0.06] bg-white/[0.02]'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
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
      <div className="flex flex-col gap-2 px-2 pb-2 min-h-[80px] max-h-[600px] overflow-y-auto">
        {items.map((item, idx) => (
          <Fragment key={item.id}>
            {dragOver && dropIndex === idx && (
              <div className="h-1 rounded-full bg-blue-400/80" />
            )}
            <div data-kanban-index={idx}>
              <KanbanCard
                item={item}
                onOpen={() => onOpen(item)}
                onMoved={(id, toStage) => onReorder(id, toStage, stage.id, 0)}
                onDeleted={(id) => onDeleted(id, stage.id)}
              />
            </div>
          </Fragment>
        ))}
        {dragOver && dropIndex === items.length && (
          <div className="h-1 rounded-full bg-blue-400/80" />
        )}

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

export function ContentPipelineBoard({ clientId, initialCardId }: { clientId: string; initialCardId?: string }) {
  const [columns, setColumns] = useState<Record<PipelineStage, PipelineItem[]>>({
    ideas: [], grabar: [], grabados: [], editados: [], por_publicar: [], publicados: [],
  })
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Toda tarjeta creada muestra un id temporal en pantalla al instante, antes
  // de que el servidor confirme la fila real — así crear se siente
  // inmediato. Este mapa deja que cualquier acción posterior sobre esa misma
  // tarjeta (abrirla, moverla, editarla, borrarla) espere el id real en vez
  // de mandar un update/delete contra un id que todavía no existe en la
  // base (lo cual antes fallaba en silencio y la tarjeta terminaba
  // "pisándose sola" con la respuesta vieja de la creación).
  const pendingCreatesRef = useRef<Map<string, Promise<PipelineItem>>>(new Map())
  const cancelledTempIdsRef = useRef<Set<string>>(new Set())

  async function openCard(item: PipelineItem | null) {
    if (item) {
      const pending = pendingCreatesRef.current.get(item.id)
      if (pending) {
        try {
          const created = await pending
          item = { ...item, id: created.id, position: created.position, created_at: created.created_at }
        } catch {
          // La creación falló — el manejador de creación ya la saca del
          // tablero, así que acá no hay nada válido para abrir.
          return
        }
      }
    }
    setSelectedItem(item)
    const params = new URLSearchParams(searchParams.toString())
    if (item) {
      params.set('tab', 'pipeline')
      params.set('card', item.id)
    } else {
      params.delete('card')
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    getPipelineItems(clientId).then((data) => {
      setColumns(data)
      setLoading(false)
      if (initialCardId) {
        const found = Object.values(data).flat().find((i) => i.id === initialCardId)
        if (found) setSelectedItem(found)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Espera el id real de una tarjeta recién creada (si hace falta) antes de
  // devolverlo — así cualquier guardado contra el servidor apunta siempre a
  // una fila que ya existe.
  async function resolveRealId(id: string): Promise<string> {
    const pending = pendingCreatesRef.current.get(id)
    if (!pending) return id
    const created = await pending
    return created.id
  }

  function persistUpdate(id: string, fields: Parameters<typeof updatePipelineItem>[2]) {
    resolveRealId(id)
      .then((realId) => updatePipelineItem(realId, clientId, fields))
      .catch((err) => console.error('No se pudo guardar el cambio:', err))
  }

  function persistDelete(id: string) {
    if (isTempId(id) && pendingCreatesRef.current.has(id)) {
      // Todavía no existe en el servidor — se marca para que, cuando la
      // creación responda, se borre la fila recién creada en vez de
      // resucitar la tarjeta que el usuario ya sacó.
      cancelledTempIdsRef.current.add(id)
      return
    }
    deletePipelineItem(id, clientId).catch((err) => console.error('No se pudo eliminar la tarjeta:', err))
  }

  // Reordena una tarjeta dentro de su columna o entre columnas, soltándola
  // en el índice exacto (calculado en KanbanColumn a partir de por encima o
  // por debajo de qué tarjeta se soltó) en vez de solo mandarla al tope.
  function handleReorder(id: string, toStage: PipelineStage, fromStage: PipelineStage, toIndex: number) {
    setColumns((prev) => {
      const sourceItems = prev[fromStage]
      const dragged = sourceItems.find((i) => i.id === id)
      if (!dragged) return prev

      const sameColumn = fromStage === toStage
      const destItems = sameColumn ? sourceItems : prev[toStage]
      const withoutItem = destItems.filter((i) => i.id !== id)

      let insertAt = Math.min(toIndex, withoutItem.length)
      if (sameColumn) {
        const srcIndex = sourceItems.findIndex((i) => i.id === id)
        if (srcIndex < toIndex) insertAt = Math.max(0, insertAt - 1)
      }

      const reordered = [
        ...withoutItem.slice(0, insertAt),
        { ...dragged, stage: toStage },
        ...withoutItem.slice(insertAt),
      ]

      reordered.forEach((item, idx) => {
        const original = destItems.find((i) => i.id === item.id)
        const positionChanged = !original || original.position !== idx
        const isDragged = item.id === id
        if (!positionChanged && !(isDragged && !sameColumn)) return
        persistUpdate(item.id, {
          position: idx,
          ...(isDragged && !sameColumn ? { stage: toStage } : {}),
        })
      })

      const finalDest = reordered.map((item, idx) => ({ ...item, position: idx }))

      if (sameColumn) return { ...prev, [toStage]: finalDest }
      return {
        ...prev,
        [fromStage]: sourceItems.filter((i) => i.id !== id),
        [toStage]: finalDest,
      }
    })
  }

  function handleDeleted(id: string, stage: PipelineStage) {
    setColumns((prev) => ({
      ...prev,
      [stage]: prev[stage].filter((i) => i.id !== id),
    }))
    if (selectedItem?.id === id) openCard(null)
    persistDelete(id)
  }

  function handleAdd(stage: PipelineStage, title: string) {
    const tempId = `temp-${crypto.randomUUID()}`
    const optimisticItem: PipelineItem = {
      id: tempId,
      client_id: clientId,
      title,
      description: null,
      script: null,
      reference_url: null,
      raw_video_url: null,
      edited_video_url: null,
      assigned_to: null,
      due_date: null,
      angle: null,
      objective: null,
      audio_url: null,
      stage,
      position: 0,
      created_at: new Date().toISOString(),
    }
    setColumns((prev) => ({ ...prev, [stage]: [...prev[stage], optimisticItem] }))

    const promise = createPipelineItem(clientId, title, stage)
    pendingCreatesRef.current.set(tempId, promise)

    promise
      .then((created) => {
        pendingCreatesRef.current.delete(tempId)
        if (cancelledTempIdsRef.current.has(tempId)) {
          cancelledTempIdsRef.current.delete(tempId)
          deletePipelineItem(created.id, clientId).catch((err) =>
            console.error('No se pudo limpiar la tarjeta cancelada:', err)
          )
          return
        }
        // Se fusiona en vez de reemplazar: conserva cualquier edición local
        // que haya pasado mientras la creación seguía en curso (título
        // reescrito, script, etapa movida a mano) y solo adopta del
        // servidor lo que el cliente no podía inventar.
        setColumns((prev) => {
          const next = { ...prev }
          for (const s of Object.keys(next) as PipelineStage[]) {
            const idx = next[s].findIndex((i) => i.id === tempId)
            if (idx === -1) continue
            const local = next[s][idx]
            next[s] = [
              ...next[s].slice(0, idx),
              { ...local, id: created.id, position: created.position, created_at: created.created_at },
              ...next[s].slice(idx + 1),
            ]
          }
          return next
        })
        setSelectedItem((prev) =>
          prev?.id === tempId ? { ...prev, id: created.id, position: created.position, created_at: created.created_at } : prev
        )
      })
      .catch((err) => {
        pendingCreatesRef.current.delete(tempId)
        console.error('No se pudo crear la tarjeta:', err)
        const wasCancelled = cancelledTempIdsRef.current.delete(tempId)
        if (!wasCancelled) {
          setColumns((prev) => ({ ...prev, [stage]: prev[stage].filter((i) => i.id !== tempId) }))
        }
      })
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
            onOpen={(item) => openCard(item)}
            onReorder={handleReorder}
            onDeleted={handleDeleted}
            onAdd={handleAdd}
          />
        ))}
      </div>

      {selectedItem && (
        <CardDetailDrawer
          item={selectedItem}
          onClose={() => openCard(null)}
          onUpdated={handleItemUpdated}
        />
      )}
    </>
  )
}
