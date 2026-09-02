'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { getFieldOptionsAction, saveFieldOptionsAction, type OptionField } from '@/lib/actions/tasks'
import type { SelectOption } from '@/lib/services/notion'
import { cn } from '@/lib/utils'

// Los colores que acepta Notion, con su equivalente visual acá.
const COLORS: { value: string; dot: string }[] = [
  { value: 'default', dot: 'bg-zinc-500' },
  { value: 'gray', dot: 'bg-zinc-400' },
  { value: 'brown', dot: 'bg-amber-800' },
  { value: 'orange', dot: 'bg-orange-500' },
  { value: 'yellow', dot: 'bg-yellow-500' },
  { value: 'green', dot: 'bg-emerald-500' },
  { value: 'blue', dot: 'bg-blue-500' },
  { value: 'purple', dot: 'bg-violet-500' },
  { value: 'pink', dot: 'bg-pink-500' },
  { value: 'red', dot: 'bg-red-500' },
]

function dotFor(color?: string) {
  return COLORS.find((c) => c.value === color)?.dot ?? 'bg-zinc-500'
}

interface Row extends SelectOption {
  /** Nombre con el que llegó de Notion, para detectar renombres. */
  originalName?: string
}

/**
 * Edita las opciones de una propiedad Select de Notion (Fase, Prioridad,
 * Responsable) sin salir del CRM.
 *
 * Renombrar arrastra a todas las tareas que ya usaban esa opción, porque
 * Notion la identifica por id y no por nombre. Borrar una opción sí pierde el
 * dato en las tareas que la tenían — por eso se avisa antes de guardar.
 */
export function FieldOptionsModal({
  clientId,
  field,
  label,
  onClose,
  onSaved,
}: {
  clientId: string
  field: OptionField
  label: string
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<{ propertyName: string; editable: boolean; reason?: string } | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getFieldOptionsAction(clientId, field)
      .then((res) => {
        if (cancelled) return
        if (!res.success) {
          setError(res.error)
          setRows([])
          return
        }
        setRows(res.data.options.map((o) => ({ ...o, originalName: o.name })))
        setMeta({ propertyName: res.data.propertyName, editable: res.data.editable, reason: res.data.reason })
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Error inesperado'))
    return () => {
      cancelled = true
    }
  }, [clientId, field])

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? prev)
  }

  function remove(index: number) {
    setRows((prev) => {
      if (!prev) return prev
      const row = prev[index]
      if (row.originalName) setRemoved((r) => [...r, row.originalName!])
      return prev.filter((_, i) => i !== index)
    })
  }

  // El orden de la lista es el orden con el que Notion muestra las opciones:
  // se manda tal cual y se respeta.
  function move(index: number, delta: number) {
    setRows((prev) => {
      if (!prev) return prev
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function add() {
    setRows((prev) => [...(prev ?? []), { name: '', color: 'default' }])
  }

  async function save() {
    if (!rows) return
    setBusy(true)
    setError(null)
    const result = await saveFieldOptionsAction(
      clientId,
      field,
      rows.filter((r) => r.name.trim()).map(({ id, name, color }) => ({ id, name: name.trim(), color }))
    ).catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : 'Error inesperado' }))
    setBusy(false)
    if (result.success) onSaved()
    else setError(result.error)
  }

  const renamed = (rows ?? []).filter((r) => r.originalName && r.name.trim() && r.name.trim() !== r.originalName)

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-base font-semibold text-zinc-100">Editar {label.toLowerCase()}</h3>
      <p className="mt-1 text-xs text-zinc-500">
        {meta?.propertyName ? (
          <>
            Cambia la propiedad <span className="text-zinc-400">{meta.propertyName}</span> en Notion. Renombrar arrastra a todas las tareas que ya la
            usan.
          </>
        ) : (
          'Se guarda directo en tu base de Notion.'
        )}
      </p>

      <div className="mt-5 space-y-2">
        {rows === null ? (
          <p className="py-8 text-center text-sm text-zinc-600 animate-pulse">Cargando desde Notion…</p>
        ) : meta && !meta.editable ? (
          <p className="py-6 text-center text-sm text-zinc-500">{meta.reason}</p>
        ) : (
          <>
            {rows.map((row, i) => (
              <div key={row.id ?? `nueva-${i}`} className="flex items-center gap-2">
                <div className="flex shrink-0 flex-col">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="Subir"
                    className="text-zinc-600 transition-colors hover:text-zinc-300 disabled:opacity-20"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    title="Bajar"
                    className="text-zinc-600 transition-colors hover:text-zinc-300 disabled:opacity-20"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <select
                  value={row.color ?? 'default'}
                  onChange={(e) => update(i, { color: e.target.value })}
                  disabled={!!row.id}
                  title={row.id ? 'Notion no permite cambiar el color de una opción que ya existe — se cambia desde Notion' : 'Color'}
                  className="shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.02] py-2 pl-2 pr-1 text-xs text-zinc-400 focus:outline-none disabled:opacity-40 [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
                >
                  {COLORS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value}
                    </option>
                  ))}
                </select>
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dotFor(row.color))} />
                <input
                  value={row.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Nombre"
                  className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:outline-none"
                />
                <button
                  onClick={() => remove(i)}
                  title="Quitar"
                  className="shrink-0 rounded-lg p-2 text-zinc-600 transition-colors hover:bg-white/[0.05] hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              onClick={add}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.08] py-2 text-xs text-zinc-500 transition-colors hover:border-white/[0.15] hover:text-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar {label.toLowerCase().replace(/s$/, '')}
            </button>
          </>
        )}

        {renamed.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-blue-900/40 bg-blue-950/15 px-3 py-2 text-xs text-blue-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              La API de Notion no deja renombrar una opción directamente, así que {renamed.map((r) => `"${r.originalName}" → "${r.name}"`).join(', ')} se
              resuelve creando la nueva, moviendo las tareas que la usaban, y borrando la vieja. Si tenés vistas filtradas por esa opción en Notion,
              revisalas después.
            </span>
          </div>
        )}

        {removed.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-900/40 bg-amber-950/15 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Al guardar se borra {removed.map((r) => `"${r}"`).join(', ')} en Notion. Las tareas que la tenían quedan sin {label.toLowerCase()} — no se
              borra ninguna tarea.
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={busy || rows === null || !meta?.editable}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar en Notion
        </button>
      </div>
    </Modal>
  )
}
